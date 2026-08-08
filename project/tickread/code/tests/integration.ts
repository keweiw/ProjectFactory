/**
 * End-to-end check against the real question bank, over HTTP.
 *
 * Separate from the unit suite because it needs a static server running:
 *
 *     python -m http.server 8765 --bind 127.0.0.1
 *     node dist/tests/integration.js
 *
 * The unit tests use fabricated questions. This one exercises the shipped data and
 * the real relative paths, which is where deployment breaks: a path that works from
 * the project root and not from a GitHub Pages subpath, a shard that fails to parse,
 * a bank too thin to fill a round, or an anonymisation rule that held for made-up
 * bars and not for the ones actually built.
 */

import { buildRound, DEFAULT_DECK_SIZE } from "../src/deck.js";
import { computePersona } from "../src/persona.js";
import { answer, createSession, currentQuestion, isFinished } from "../src/session.js";
import { buildScorecard } from "../src/stats.js";
import { describeQuestion } from "../src/app.js";
import { formatMetric } from "../src/report-view.js";
import {
  SETUP_LENGTH,
  type AnswerRecord,
  type Direction,
  type Manifest,
  type Question,
} from "../src/types.js";

const BASE = "http://127.0.0.1:8765";
const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ok    ${message}`);
  } else {
    console.log(`  FAIL  ${message}`);
    failures.push(message);
  }
}

async function checkStaticAssets(): Promise<void> {
  console.log("\nStatic assets resolve at their relative paths");
  for (const path of [
    "/index.html",
    "/style.css",
    "/dist/src/app.js",
    "/dist/src/chart.js",
    "/data/manifest.json",
    "/data/demo.json",
    "/dist/src/tape.js",
    "/dist/src/demo.js",
    "/dist/src/report-view.js",
  ]) {
    const response = await fetch(`${BASE}${path}`);
    check(response.ok, `${path} -> HTTP ${response.status}`);
  }
}

/**
 * The landing page fetches demo.json at boot and hands its ids to buildRound as
 * already-seen. If the file drifts from the shards, a player gets dealt a chart
 * whose answer they just watched play out.
 */
async function checkDemoData(): Promise<void> {
  console.log("\ndemo.json is usable and excluded from real rounds");
  const response = await fetch(`${BASE}/data/demo.json`);
  check(response.ok, `demo.json -> HTTP ${response.status}`);
  if (!response.ok) return;

  const payload = (await response.json()) as { questions?: Question[] };
  const demo = payload.questions ?? [];
  check(demo.length > 0, `${demo.length} demo questions`);

  // It exists so the landing page does not have to pull a 1.8 MB shard.
  const bytes = JSON.stringify(payload).length;
  check(bytes < 200_000, `demo.json is ${(bytes / 1024).toFixed(0)} KB, under 200 KB`);

  for (const question of demo) {
    check(question.setup.length > 0, `${question.id} has a setup`);
    check(question.future.length > 0, `${question.id} has a future to reveal`);
    check(
      question.answer === "up" || question.answer === "down",
      `${question.id} has a direction`,
    );
  }

  // Every demo id must exist in a shard, or the exclusion excludes nothing.
  const manifest = (await (await fetch(`${BASE}/data/manifest.json`)).json()) as Manifest;
  const shipped = new Set<string>();
  for (const shard of manifest.shards) {
    const items = (await (await fetch(`${BASE}/data/${shard.file}`)).json()) as Question[];
    for (const item of items) shipped.add(item.id);
  }
  for (const question of demo) {
    check(shipped.has(question.id), `${question.id} resolves to a shipped question`);
  }
}

/**
 * app.ts throws at startup if any element it needs is absent. That is the right
 * behaviour, but it means a typo in either file is only caught by opening the page.
 * This compares the two directly.
 */
async function checkElementContract(): Promise<void> {
  console.log("\nindex.html satisfies the element contract in app.ts");
  // Read over HTTP rather than from disk: no @types/node here, and this checks the
  // files as actually served.
  const html = await (await fetch(`${BASE}/index.html`)).text();
  const source = await (await fetch(`${BASE}/src/app.ts`)).text();

  const block = source.match(/const REQUIRED_IDS = \[([\s\S]*?)\]/);
  check(block !== null, "REQUIRED_IDS found in app.ts");
  if (!block) return;

  const required = [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const present = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!));
  check(required.length > 0, `${required.length} ids required`);
  for (const id of required) {
    check(present.has(id), `#${id} present in index.html`);
  }
}

async function checkFullRound(): Promise<void> {
  console.log("\nA full round runs against the shipped bank");

  const questions = await buildRound(`${BASE}/data`);
  check(questions.length === DEFAULT_DECK_SIZE, `drew ${questions.length} questions`);
  check(new Set(questions.map((q) => q.id)).size === questions.length, "no repeats in the round");

  // The mix is deliberately left as sampled, so there is nothing to assert about it.
  const up = questions.filter((q) => q.answer === "up").length;
  console.log(`  note  answer mix as sampled: ${up} up, ${questions.length - up} down`);

  // Ten questions round-robin over twelve strata, so every one of them should be a
  // different stratum. A round no longer covers all twelve, and is not meant to.
  const strata = new Set(questions.map((q) => `${q.timeframe}|${q.horizon}`));
  check(
    strata.size === DEFAULT_DECK_SIZE,
    `${strata.size} distinct timeframe/horizon strata`,
  );

  console.log("\nShipped questions obey the anonymisation rules");
  let badShape = 0;
  let datedBar = 0;
  for (const q of questions) {
    if (q.setup.length !== SETUP_LENGTH || q.future.length !== q.horizon) badShape++;
    for (const bar of [...q.setup, ...q.future]) {
      const keys = Object.keys(bar).sort().join(",");
      if (keys !== "c,h,l,o,v") datedBar++;
    }
  }
  check(badShape === 0, "every question has 60 setup bars and horizon future bars");
  check(datedBar === 0, "no shipped bar carries a timestamp or any extra field");
  check(
    questions.every((q) => !/[a-z]{2,}/i.test(q.id) || /^[0-9a-f]{12}$/.test(q.id)),
    "question ids are opaque hex",
  );

  const meta = questions.map(describeQuestion);
  check(
    meta.every((m) => !/\b(19|20)\d{2}\b/.test(m)),
    "no card header contains anything year-like",
  );

  console.log("\nAnswering the whole round produces a usable report");
  // Alternate the swipe so the persona metrics have both groups to work with.
  let session = createSession(questions);
  let index = 0;
  while (!isFinished(session)) {
    const given: Direction = index % 2 === 0 ? "up" : "down";
    check(currentQuestion(session) !== null, `question ${index + 1} available`);
    session = answer(session, given, 800 + index * 10);
    index++;
  }
  const records: readonly AnswerRecord[] = session.records;
  check(records.length === DEFAULT_DECK_SIZE, `recorded ${records.length} answers`);

  const scorecard = buildScorecard(records);
  check(scorecard.overall.total === DEFAULT_DECK_SIZE, "scorecard counts every answer");
  check(
    scorecard.byAssetClass.reduce((a, r) => a + r.total, 0) === DEFAULT_DECK_SIZE,
    "asset-class buckets account for every answer",
  );
  check(
    scorecard.byTimeframe.every((r) => r.interval.low >= 0 && r.interval.high <= 1),
    "every confidence interval is inside [0,1]",
  );
  check(
    scorecard.byTimeframe.every((r) => r.total >= 8 || r.significance === "inconclusive"),
    "no small bucket is called a strength or a weakness",
  );

  const persona = computePersona(records);
  check(persona.metrics.bullBias !== null, "bull bias computed");
  check(
    formatMetric(persona.metrics.momentumScore, "signed") !== "",
    "momentum renders (or reports insufficient data)",
  );

  console.log(
    `\n  round summary: ${scorecard.overall.correct}/${DEFAULT_DECK_SIZE} correct`,
  );
  console.log(`  persona: ${persona.label ?? "not enough data"}`);
  console.log(`  strata covered: ${[...strata].sort().join(", ")}`);
}

async function main(): Promise<void> {
  console.log(`tickread integration check against ${BASE}`);
  try {
    await checkStaticAssets();
    await checkElementContract();
    await checkDemoData();
    await checkFullRound();
  } catch (error) {
    console.log(`\nAborted: ${error instanceof Error ? error.stack : String(error)}`);
    failures.push("threw");
  }

  console.log(
    failures.length === 0
      ? "\nAll integration checks passed."
      : `\n${failures.length} checks FAILED:\n  - ${failures.join("\n  - ")}`,
  );
  const proc = (globalThis as { process?: { exitCode?: number } }).process;
  if (proc && failures.length > 0) proc.exitCode = 1;
}

void main();
