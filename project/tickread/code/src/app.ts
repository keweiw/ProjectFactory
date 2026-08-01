/**
 * Entry point, and the only module that touches the DOM.
 *
 * Every other module is pure by design. This one absorbs all the impurity — DOM,
 * timers, requestAnimationFrame, localStorage construction, fetch kickoff — so that
 * none of it leaks into the logic that needs testing. The handful of decisions in
 * here that are worth testing are extracted as pure functions and exported.
 *
 * See specs/app.md.
 */

import { buildRound } from "./deck.js";
import { renderChart, DEFAULT_THEME } from "./chart.js";
import { computePersona } from "./persona.js";
import { answer, createSession, currentQuestion, isFinished, progress } from "./session.js";
import { buildScorecard } from "./stats.js";
import { createHistoryStore, type HistoryStore } from "./storage.js";
import type {
  AnswerRecord,
  AssetClass,
  BucketStat,
  Direction,
  Horizon,
  Question,
  SessionState,
  Timeframe,
} from "./types.js";

export type View = "start" | "deck" | "report" | "error";
export type ReportMode = "round" | "allTime";

const DATA_URL = "./data";
const COMMIT_FRACTION = 0.25;
const FLICK_VELOCITY = 0.5;
const REVEAL_MS = 600;
const HOLD_MS = 900;

// --- pure helpers, unit tested ------------------------------------------------

/** Which way a released drag commits, or null to spring back. */
export function shouldCommit(
  deltaX: number,
  cardWidth: number,
  velocity: number,
): Direction | null {
  if (cardWidth <= 0) return null;
  const farEnough = Math.abs(deltaX) > cardWidth * COMMIT_FRACTION;
  // A quick flick counts even when it is short, otherwise the gesture feels stuck.
  const fastEnough = Math.abs(velocity) > FLICK_VELOCITY && Math.abs(deltaX) > 8;
  if (!farEnough && !fastEnough) return null;
  return deltaX > 0 ? "up" : "down";
}

const TIMEFRAME_WORDS: Record<Timeframe, string> = {
  "1m": "1-minute",
  "1h": "Hourly",
  "1d": "Daily",
  "1mo": "Monthly",
};

const ASSET_WORDS: Record<AssetClass, string> = {
  equity: "US equity",
  etf_index: "ETF / index",
  future: "Futures",
  crypto: "Crypto",
};

/**
 * The card's header line. States how far ahead the question looks, and never which
 * instrument or when — that is the anonymisation rule at the text layer.
 */
export function describeQuestion(question: Question): string {
  const horizon: Horizon = question.horizon;
  const ahead = horizon === 1 ? "next bar" : `next ${horizon} bars`;
  return `${TIMEFRAME_WORDS[question.timeframe]} · ${ASSET_WORDS[question.assetClass]} · ${ahead}`;
}

export type MetricKind = "percent" | "signed" | "ms" | "ratio";

/**
 * Renders a persona metric. A null metric means the sample could not support it,
 * and must never appear as 0 — that would present an absent measurement as a
 * finding about the user.
 */
export function formatMetric(value: number | null, kind: MetricKind): string {
  if (value === null) return "not enough data";
  switch (kind) {
    case "percent":
      return `${(value * 100).toFixed(0)}%`;
    case "signed":
      return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
    case "ms":
      return `${(value / 1000).toFixed(1)}s`;
    case "ratio":
      return value.toFixed(2);
  }
}

// --- DOM wiring ---------------------------------------------------------------

interface Elements {
  [id: string]: HTMLElement;
}

const REQUIRED_IDS = [
  "view-start", "view-deck", "view-report", "view-error",
  "start-button", "card", "chart-canvas", "card-meta", "progress",
  "verdict", "report-body", "report-mode", "restart-button", "error-message",
  "start-summary", "error-retry",
];

function resolveElements(): Elements {
  const found: Elements = {};
  for (const id of REQUIRED_IDS) {
    const element = document.getElementById(id);
    // A missing element is a build error, not a runtime condition. Failing loudly
    // beats degrading into a half-working page.
    if (!element) throw new Error(`tickread: index.html is missing #${id}`);
    found[id] = element;
  }
  return found;
}

interface AppState {
  view: View;
  session: SessionState;
  store: HistoryStore;
  shownAt: number;
  busy: boolean;
  reportMode: ReportMode;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function significanceLabel(stat: BucketStat): string {
  if (stat.significance === "strength") return `<span class="tag good">strength</span>`;
  if (stat.significance === "weakness") return `<span class="tag bad">weakness</span>`;
  return `<span class="tag muted">not enough data</span>`;
}

const BUCKET_WORDS: Record<string, string> = {
  ...TIMEFRAME_WORDS,
  ...ASSET_WORDS,
  "1": "next bar",
  "5": "next 5 bars",
  "20": "next 20 bars",
  overall: "Overall",
};

function statRows(rows: BucketStat[]): string {
  return rows
    .map((row) => {
      const label = BUCKET_WORDS[row.key] ?? row.key;
      const pct = (row.accuracy * 100).toFixed(0);
      const lo = (row.interval.low * 100).toFixed(0);
      const hi = (row.interval.high * 100).toFixed(0);
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td class="num">${pct}%</td>
        <td class="num muted">n=${row.total}</td>
        <td class="num muted">${lo}–${hi}%</td>
        <td>${significanceLabel(row)}</td>
      </tr>`;
    })
    .join("");
}

function renderReport(elements: Elements, records: readonly AnswerRecord[]): void {
  const scorecard = buildScorecard(records);
  const persona = computePersona(records);
  const overall = scorecard.overall;

  const section = (title: string, rows: BucketStat[]): string =>
    rows.length === 0
      ? ""
      : `<h3>${title}</h3><table class="stats">
           <thead><tr><th></th><th class="num">accuracy</th><th class="num">sample</th>
           <th class="num">95% range</th><th></th></tr></thead>
           <tbody>${statRows(rows)}</tbody></table>`;

  const metrics = persona.metrics;
  const metricRow = (name: string, shown: string, hint: string): string =>
    `<tr><td>${name}</td><td class="num">${escapeHtml(shown)}</td>
       <td class="muted">${escapeHtml(hint)}</td></tr>`;

  elements["report-body"]!.innerHTML = `
    <div class="headline">
      <div class="big">${(overall.accuracy * 100).toFixed(0)}%</div>
      <div class="muted">${overall.correct} of ${overall.total} correct
        · 95% range ${(overall.interval.low * 100).toFixed(0)}–${(overall.interval.high * 100).toFixed(0)}%</div>
    </div>

    <p class="note">A cell is only called a strength or a weakness when it has at
    least 8 answers <em>and</em> its confidence range clears 50%. Twenty questions
    split three ways is thin, so most cells stay undecided until you have played a
    few rounds — switch to “All time” once you have.</p>

    ${section("By asset class", scorecard.byAssetClass)}
    ${section("By timeframe", scorecard.byTimeframe)}
    ${section("By horizon", scorecard.byHorizon)}

    <h3>How you decide</h3>
    <div class="persona-label">${escapeHtml(persona.label ?? "Not enough data yet")}</div>
    <table class="stats">
      <tbody>
        ${metricRow("Bull bias", formatMetric(metrics.bullBias, "percent"), "share of up swipes")}
        ${metricRow("Momentum vs reversion", formatMetric(metrics.momentumScore, "signed"), "positive follows the trend, negative fades it")}
        ${metricRow("Volume sensitivity", formatMetric(metrics.volumeSensitivity, "signed"), "how a volume surge shifts your call")}
        ${metricRow("Volatility sensitivity", formatMetric(metrics.volatilitySensitivity, "signed"), "how choppiness shifts your call")}
        ${metricRow("Decision speed", formatMetric(metrics.decisionSpeedMs, "ms"), "median time per card")}
        ${metricRow("Consistency", formatMetric(metrics.consistency, "ratio"), "1.00 means the same call on similar charts")}
      </tbody>
    </table>
  `;
}

export function main(): void {
  const elements = resolveElements();

  const state: AppState = {
    view: "start",
    session: createSession([]),
    store: createHistoryStore(),
    shownAt: 0,
    busy: false,
    reportMode: "allTime",
  };

  const canvas = elements["chart-canvas"] as HTMLCanvasElement;
  const card = elements["card"]!;

  function show(view: View): void {
    state.view = view;
    for (const name of ["start", "deck", "report", "error"] as const) {
      elements[`view-${name}`]!.hidden = name !== view;
    }
  }

  function fail(message: string): void {
    elements["error-message"]!.textContent = message;
    show("error");
  }

  function paint(revealCount: number): void {
    const question = currentQuestion(state.session);
    if (!question) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width || canvas.clientWidth;
    const height = rect.height || canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderChart(ctx, question.setup, question.future, {
      width, height, dpr, revealCount, theme: DEFAULT_THEME,
    });
  }

  function renderCard(): void {
    const question = currentQuestion(state.session);
    if (!question) return;
    card.style.transform = "";
    card.classList.remove("tint-up", "tint-down");
    elements["verdict"]!.textContent = "";
    elements["verdict"]!.className = "verdict";
    elements["card-meta"]!.textContent = describeQuestion(question);
    const { answered, total } = progress(state.session);
    elements["progress"]!.textContent = `${answered + 1} / ${total}`;
    paint(0);
    state.shownAt = performance.now();
    state.busy = false;
  }

  function finishRound(): void {
    state.store.appendRecords(state.session.records);
    const history = state.store.loadHistory();
    state.reportMode = history.length > state.session.records.length ? "allTime" : "round";
    renderReportForMode();
    show("report");
  }

  function renderReportForMode(): void {
    const records =
      state.reportMode === "round" ? state.session.records : state.store.loadHistory();
    renderReport(elements, records);
    for (const button of elements["report-mode"]!.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset["mode"] === state.reportMode);
    }
  }

  function reveal(given: Direction): void {
    const question = currentQuestion(state.session)!;
    const responseMs = performance.now() - state.shownAt;
    state.session = answer(state.session, given, responseMs);
    const record = state.session.records[state.session.records.length - 1]!;

    const verdict = elements["verdict"]!;
    verdict.textContent = record.correct ? "Correct" : "Wrong";
    verdict.className = `verdict ${record.correct ? "good" : "bad"}`;

    const steps = question.future.length;
    const started = performance.now();
    const step = (): void => {
      const ratio = Math.min(1, (performance.now() - started) / REVEAL_MS);
      paint(Math.max(1, Math.round(ratio * steps)));
      if (ratio < 1) {
        requestAnimationFrame(step);
        return;
      }
      window.setTimeout(() => {
        if (isFinished(state.session)) finishRound();
        else renderCard();
      }, HOLD_MS);
    };
    requestAnimationFrame(step);
  }

  function commit(given: Direction): void {
    if (state.busy || state.view !== "deck" || isFinished(state.session)) return;
    state.busy = true;
    card.style.transform = `translateX(${given === "up" ? 140 : -140}%) rotate(${given === "up" ? 18 : -18}deg)`;
    reveal(given);
  }

  // --- gesture ---
  let dragging = false;
  let originX = 0;
  let originT = 0;
  let deltaX = 0;

  card.addEventListener("pointerdown", (event) => {
    if (state.busy) return;
    dragging = true;
    originX = event.clientX;
    originT = performance.now();
    deltaX = 0;
    card.setPointerCapture(event.pointerId);
    card.classList.add("dragging");
  });

  card.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    deltaX = event.clientX - originX;
    const rotation = Math.max(-15, Math.min(15, deltaX / 20));
    card.style.transform = `translateX(${deltaX}px) rotate(${rotation}deg)`;
    card.classList.toggle("tint-up", deltaX > 12);
    card.classList.toggle("tint-down", deltaX < -12);
  });

  function release(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    try {
      card.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone; nothing to release.
    }
    const velocity = deltaX / Math.max(1, performance.now() - originT);
    const decision = shouldCommit(deltaX, card.getBoundingClientRect().width, velocity);
    if (decision) {
      commit(decision);
    } else {
      card.style.transform = "";
      card.classList.remove("tint-up", "tint-down");
    }
  }

  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);

  document.addEventListener("keydown", (event) => {
    if (state.view !== "deck") return;
    if (event.key === "ArrowRight") commit("up");
    if (event.key === "ArrowLeft") commit("down");
  });

  // --- round lifecycle ---
  async function startRound(): Promise<void> {
    const button = elements["start-button"] as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Loading charts…";
    try {
      const questions = await buildRound(DATA_URL, { seen: state.store.loadSeen() });
      if (questions.length === 0) {
        fail("The question bank is empty. Rebuild it with scripts/build_deck.py.");
        return;
      }
      state.store.markSeen(questions.map((q) => q.id));
      state.session = createSession(questions);
      show("deck");
      renderCard();
    } catch (error) {
      fail(
        `Could not load the question bank. ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      button.disabled = false;
      button.textContent = "Start";
    }
  }

  elements["start-button"]!.addEventListener("click", () => void startRound());
  elements["error-retry"]!.addEventListener("click", () => void startRound());
  elements["restart-button"]!.addEventListener("click", () => {
    show("start");
    renderStartSummary();
  });

  elements["report-mode"]!.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const mode = target.dataset["mode"];
    if (mode === "round" || mode === "allTime") {
      state.reportMode = mode;
      renderReportForMode();
    }
  });

  window.addEventListener("resize", () => {
    if (state.view === "deck" && !state.busy) paint(0);
  });

  function renderStartSummary(): void {
    const history = state.store.loadHistory();
    if (history.length === 0) {
      elements["start-summary"]!.textContent = "";
      return;
    }
    const correct = history.filter((r) => r.correct).length;
    const rounds = Math.round(history.length / 20);
    elements["start-summary"]!.textContent =
      `${history.length} answers so far (about ${rounds} rounds) · ` +
      `${((correct / history.length) * 100).toFixed(0)}% correct`;
  }

  renderStartSummary();
  show("start");
}
