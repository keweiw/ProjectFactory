import { test, assert, assertClose, assertEqual } from "./harness.js";
import {
  answersNeededForVerdict,
  answersToUnlock,
  buildAdvice,
  gradeFor,
  personaShape,
  roundAccuracies,
  skillGrid,
} from "../src/advice.js";
import { buildScorecard, wilsonInterval } from "../src/stats.js";
import type { AnswerRecord, PersonaResult, Timeframe } from "../src/types.js";

const NEUTRAL_PERSONA: PersonaResult = {
  metrics: {
    bullBias: 0.5,
    momentumScore: 0,
    volumeSensitivity: 0,
    volatilitySensitivity: 0,
    decisionSpeedMs: 2000,
    consistency: 0.5,
  },
  momentumAxis: "neutral",
  biasAxis: "balanced",
  label: "Coin Flipper",
};

let seq = 0;
function record(correct: boolean, timeframe: Timeframe = "1d"): AnswerRecord {
  seq++;
  return {
    questionId: `q${seq}`,
    assetClass: "equity",
    timeframe,
    horizon: 5,
    given: "up",
    answer: correct ? "up" : "down",
    correct,
    responseMs: 1500,
    features: { tailTrend: 0, volumeSurge: false, realisedVol: 0.01 },
    ts: seq,
  };
}

/** `hits` correct out of `total`, all in one timeframe. */
function run(hits: number, total: number, timeframe: Timeframe = "1d"): AnswerRecord[] {
  return Array.from({ length: total }, (_, i) => record(i < hits, timeframe));
}

function advise(records: AnswerRecord[], persona = NEUTRAL_PERSONA) {
  return buildAdvice(buildScorecard(records), persona, 10);
}

// --- answersNeededForVerdict: the honest projection ---

test("answersNeededForVerdict returns a sample whose interval actually clears 50%", () => {
  const needed = answersNeededForVerdict(0.7, 10);
  assert(needed !== null, "70% must be reachable");
  const interval = wilsonInterval(Math.round(0.7 * needed!), needed!);
  assert(interval.low > 0.5, `interval ${interval.low}-${interval.high} does not clear 50%`);
});

test("answersNeededForVerdict returns a smaller sample for a stronger edge", () => {
  const strong = answersNeededForVerdict(0.9, 10);
  const weak = answersNeededForVerdict(0.6, 10);
  assert(strong !== null && weak !== null, "both must be reachable");
  assert(strong! < weak!, `0.9 needed ${strong}, 0.6 needed ${weak}`);
});

test("answersNeededForVerdict works below 50% too", () => {
  const needed = answersNeededForVerdict(0.25, 10);
  assert(needed !== null, "being reliably wrong is also reachable");
  const interval = wilsonInterval(Math.round(0.25 * needed!), needed!);
  assert(interval.high < 0.5, "a low accuracy must clear 50% from below");
});

test("answersNeededForVerdict gives up on an exact coin flip", () => {
  assertEqual(answersNeededForVerdict(0.5, 10), null, "50% never clears 50%");
});

test("answersNeededForVerdict never proposes fewer answers than you already have", () => {
  const needed = answersNeededForVerdict(0.9, 400);
  assert(needed !== null && needed >= 400, `projected backwards to ${needed}`);
});

// --- roundAccuracies: the trend line ---

test("roundAccuracies gives one point per completed round", () => {
  assertEqual(roundAccuracies(run(15, 30), 10).length, 3);
});

test("roundAccuracies drops a trailing partial round", () => {
  // 24 answers at a round size of 10 is two rounds and a fragment. The fragment
  // would swing wildly on the next card and read as a collapse in form.
  assertEqual(roundAccuracies(run(12, 24), 10).length, 2);
  assertEqual(roundAccuracies(run(5, 9), 10).length, 0, "no complete round yet");
});

test("roundAccuracies reports each round's own accuracy in order", () => {
  // First ten all correct, second ten all wrong.
  const records = [...run(10, 10), ...run(0, 10)];
  assertEqual(roundAccuracies(records, 10), [1, 0]);
});

test("roundAccuracies survives a degenerate round size", () => {
  assertEqual(roundAccuracies(run(2, 4), 0).length, 4, "a zero size must not divide by zero");
  assertEqual(roundAccuracies([], 10), []);
});

// --- the character sheet ---

test("personaShape maps every axis onto a common 0..1 scale", () => {
  const shape = personaShape(NEUTRAL_PERSONA.metrics);
  assertEqual(shape.length, 4);
  for (const axis of shape) {
    assert(axis.value >= 0 && axis.value <= 1, `${axis.label} out of range: ${axis.value}`);
    assertEqual(axis.unknown, false, `${axis.label} should be measured`);
  }
});

test("personaShape puts a neutral player at the centre of every axis", () => {
  for (const axis of personaShape(NEUTRAL_PERSONA.metrics)) {
    assertClose(axis.value, 0.5, 6, `${axis.label} should sit at the middle`);
  }
});

test("personaShape flags an unmeasured axis instead of plotting a fake middle", () => {
  const shape = personaShape({ ...NEUTRAL_PERSONA.metrics, momentumScore: null, bullBias: null });
  const flagged = shape.filter((a) => a.unknown).map((a) => a.label);
  assertEqual(flagged.sort(), ["Bullish", "Momentum"], "null metrics must be marked unknown");
  // They still plot at the centre so the outline stays drawable.
  for (const axis of shape) assert(axis.value >= 0 && axis.value <= 1, "still in range");
});

test("personaShape clamps a metric that runs past its axis", () => {
  const shape = personaShape({ ...NEUTRAL_PERSONA.metrics, momentumScore: 9, volumeSensitivity: -9 });
  const byLabel = Object.fromEntries(shape.map((a) => [a.label, a.value]));
  assertEqual(byLabel["Momentum"], 1);
  assertEqual(byLabel["Volume"], 0);
});

test("gradeFor never presents an unsupported grade as settled", () => {
  // 6/10 is a B by the bands but nowhere near significant — exactly the case where
  // showing a bare letter would be the lie.
  const thin = buildScorecard(run(6, 10)).overall;
  assertEqual(thin.significance, "inconclusive", "fixture: 60% over 10 cannot settle");
  assertEqual(gradeFor(thin).letter, "B", "the letter is still computed");
  assertEqual(gradeFor(thin).provisional, true, "but it is marked as decoration");
});

test("gradeFor settles once the interval clears 50%", () => {
  const solid = buildScorecard(run(80, 100)).overall;
  assertEqual(solid.significance, "strength", "fixture check");
  assertEqual(gradeFor(solid).provisional, false);
  assertEqual(gradeFor(solid).letter, "S");
});

test("gradeFor walks the bands in order and bottoms out at F", () => {
  const letters = [95, 70, 60, 50, 40, 10].map((hits) => gradeFor(buildScorecard(run(hits, 100)).overall).letter);
  assertEqual(letters, ["S", "A", "B", "C", "D", "F"]);
});

test("gradeFor survives an empty history", () => {
  const grade = gradeFor(buildScorecard([]).overall);
  assertEqual(grade.provisional, true);
  assert(grade.letter.length > 0 && grade.letter !== "NaN", grade.letter);
});

test("skillGrid always returns all twelve cells", () => {
  assertEqual(skillGrid([]).length, 12);
  assertEqual(skillGrid(run(5, 10)).length, 12, "cells exist whether or not they were played");
});

test("skillGrid locks a cell that has never been answered", () => {
  const cells = skillGrid([]);
  assert(cells.every((c) => c.state === "locked"), "an empty history locks everything");
  assert(cells.every((c) => c.accuracy === null), "a locked cell has no accuracy to show");
});

test("skillGrid leaves a played but unproven cell open rather than calling it", () => {
  // Four answers is under MIN_SAMPLE, so nothing can be claimed either way.
  const cells = skillGrid(run(4, 4, "1d"));
  const played = cells.filter((c) => c.total > 0);
  assert(played.length > 0, "fixture must play something");
  assert(played.every((c) => c.state === "open"), "under the sample floor nothing is called");
});

test("skillGrid clears a cell only once it is significant", () => {
  const cells = skillGrid(run(20, 20, "1mo"));
  const played = cells.filter((c) => c.total > 0);
  assert(played.length > 0, "fixture must play something");
  assert(played.every((c) => c.state === "cleared"), `expected cleared, got ${played.map((c) => c.state)}`);
});

test("skillGrid marks a significant loss as failed, not locked", () => {
  const cells = skillGrid(run(0, 20, "1h"));
  const played = cells.filter((c) => c.total > 0);
  assert(played.every((c) => c.state === "failed"), "being reliably wrong is a result, not an absence");
});

test("answersToUnlock counts down to the sample floor and stops at zero", () => {
  assertEqual(answersToUnlock(skillGrid([])[0]!), 8, "a locked cell needs the full floor");
  const busy = skillGrid(run(20, 20, "1mo")).find((c) => c.total > 0)!;
  assertEqual(answersToUnlock(busy), 0, "never negative once past the floor");
});

// --- buildAdvice: the significance gate is the whole point ---

test("buildAdvice withholds a verdict while nothing is significant", () => {
  const advice = advise(run(6, 10));
  assertEqual(advice.settled, false, "60% over 10 answers is nowhere near significant");
  assert(advice.progress !== null, "an unsettled verdict must show progress");
  assertEqual(advice.progress!.answers, 10);
});

test("buildAdvice projects the rounds still to play", () => {
  const advice = advise(run(7, 10));
  assert(advice.progress !== null, "expected progress");
  assert(advice.progress!.target !== null, "70% is projectable");
  assert(advice.progress!.roundsLeft !== null && advice.progress!.roundsLeft > 0, "rounds remain");
});

test("buildAdvice admits when a coin flip can never settle", () => {
  const advice = advise(run(50, 100));
  assertEqual(advice.settled, false);
  assertEqual(advice.progress!.target, null, "an exact 50% has no target");
  assert(/never|coin flip/i.test(advice.body), advice.body);
});

test("buildAdvice calls a significant overall weakness the reverse indicator", () => {
  const records = run(20, 100);
  const scorecard = buildScorecard(records);
  assertEqual(scorecard.overall.significance, "weakness", "fixture must be significant");
  const advice = advise(records);
  assertEqual(advice.settled, true);
  assert(/reverse/i.test(advice.title), advice.title);
  assert(advice.suggestion !== null, "a settled verdict carries a suggestion");
});

test("buildAdvice credits a significant overall strength", () => {
  const records = run(80, 100);
  assertEqual(buildScorecard(records).overall.significance, "strength", "fixture must be significant");
  const advice = advise(records);
  assertEqual(advice.settled, true);
  assert(!/reverse/i.test(advice.title), `a winner must not be called a reverse indicator: ${advice.title}`);
});

test("buildAdvice settles on a specialism when the overall is a coin flip", () => {
  // Strong on monthly, equally bad on daily, so the two cancel to exactly 50%
  // overall. The average says nothing; the buckets say a lot.
  const records = [...run(35, 40, "1mo"), ...run(5, 40, "1d")];
  const scorecard = buildScorecard(records);
  assertEqual(scorecard.overall.significance, "inconclusive", "fixture: overall must be a coin flip");
  assertEqual(
    scorecard.byTimeframe.find((b) => b.key === "1mo")!.significance,
    "strength",
    "fixture: monthly must be significant",
  );

  const advice = advise(records);
  assertEqual(advice.settled, true, "a significant bucket settles the verdict");
  const all = `${advice.title} ${advice.body} ${advice.suggestion}`;
  assert(/monthly/i.test(all), `the verdict must name the bucket: ${all}`);
  assertEqual(advice.progress, null, "a settled verdict shows no progress bar");
});

test("buildAdvice reports a blind spot when only a weakness is significant", () => {
  // Daily is significantly bad; nothing else clears the bar, and the overall
  // is dragged only to inconclusive rather than all the way to significant.
  // Monthly 26/46 stays inconclusive (CI 42–70%), daily 2/24 clears from below
  // (CI 2–26%), and the pair leaves the overall at 28/70 (CI 29–52%) — inconclusive.
  const records = [...run(26, 46, "1mo"), ...run(2, 24, "1d")];
  const scorecard = buildScorecard(records);
  assertEqual(scorecard.overall.significance, "inconclusive", "fixture: overall must be a coin flip");
  assertEqual(
    scorecard.byTimeframe.find((b) => b.key === "1mo")!.significance,
    "inconclusive",
    "fixture: monthly must not steal the verdict",
  );
  assertEqual(
    scorecard.byTimeframe.find((b) => b.key === "1d")!.significance,
    "weakness",
    "fixture: daily must be significant",
  );

  const advice = advise(records);
  assertEqual(advice.settled, true);
  assert(
    /daily/i.test(`${advice.title} ${advice.body} ${advice.suggestion}`),
    "the verdict must name the weak bucket",
  );
});

test("buildAdvice never claims anything from an empty history", () => {
  const advice = advise([]);
  assertEqual(advice.settled, false);
  assert(advice.title.length > 0, "there is always something to show");
  assert(!advice.body.includes("NaN"), advice.body);
  assert(!advice.body.includes("undefined"), advice.body);
});

test("buildAdvice never emits a placeholder into user-facing copy", () => {
  const cases: AnswerRecord[][] = [[], run(0, 10), run(10, 10), run(20, 100), run(80, 100), run(50, 100)];
  for (const records of cases) {
    const advice = advise(records);
    const all = `${advice.title} ${advice.body} ${advice.suggestion ?? ""}`;
    assert(!/NaN|undefined|null|\$\{/.test(all), `placeholder leaked: ${all}`);
  }
});

test("buildAdvice never leaks a ticker or a date into its copy", () => {
  const advice = advise(run(20, 100));
  const all = `${advice.title} ${advice.body} ${advice.suggestion ?? ""}`;
  assert(!/\b(19|20)\d{2}\b/.test(all), `year-like token: ${all}`);
});
