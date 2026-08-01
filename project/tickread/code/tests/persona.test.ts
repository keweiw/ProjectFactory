import { test, assertClose, assertEqual, assertThrows } from "./harness.js";
import { extractFeatures, computePersona } from "../src/persona.js";
import type { AnswerRecord, Bar, Direction, Question, QuestionFeatures } from "../src/types.js";

function bar(c: number, v = 1000): Bar {
  return { o: c, h: c, l: c, c, v };
}

/** A 60-bar setup with the given closes, padded at the front with a flat run. */
function setupWithCloses(closes: number[], volumes?: number[]): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) {
    const c = closes[i] ?? 100;
    bars.push(bar(c, volumes?.[i] ?? 1000));
  }
  return bars;
}

function question(over: Partial<Question> = {}): Question {
  return {
    id: "q",
    assetClass: "equity",
    timeframe: "1d",
    horizon: 5,
    setup: setupWithCloses([]),
    future: [bar(101)],
    answer: "up",
    ...over,
  };
}

function rec(
  given: Direction,
  features: Partial<QuestionFeatures> = {},
  responseMs = 1000,
): AnswerRecord {
  return {
    questionId: "q",
    assetClass: "equity",
    timeframe: "1d",
    horizon: 5,
    given,
    answer: "up",
    correct: given === "up",
    responseMs,
    features: { tailTrend: 0, volumeSurge: false, realisedVol: 0.01, ...features },
    ts: 0,
  };
}

// --- extractFeatures ---

test("extractFeatures reads tailTrend from the last ten bars", () => {
  const rising = setupWithCloses([]);
  rising[49] = bar(100);
  rising[59] = bar(110);
  assertEqual(extractFeatures(question({ setup: rising })).tailTrend, 1);

  const falling = setupWithCloses([]);
  falling[49] = bar(110);
  falling[59] = bar(100);
  assertEqual(extractFeatures(question({ setup: falling })).tailTrend, -1);
});

test("extractFeatures reports tailTrend zero when the last ten bars are flat", () => {
  const flat = setupWithCloses([]);
  flat[49] = bar(100);
  flat[59] = bar(100);
  assertEqual(extractFeatures(question({ setup: flat })).tailTrend, 0);
});

test("extractFeatures needs volume strictly above 1.5x to call it a surge", () => {
  // Volumes chosen so both means are exact in binary and the ratio is exactly 1.5:
  // 55 bars at 21 and 5 bars at 33 give mean(all) = 1320/60 = 22 and
  // mean(last 5) = 33, and 1.5 * 22 === 33 with no floating point slack.
  const atBoundary = new Array<number>(60).fill(21);
  for (let i = 55; i < 60; i++) atBoundary[i] = 33;
  assertEqual(
    extractFeatures(question({ setup: setupWithCloses([], atBoundary) })).volumeSurge,
    false,
    "exactly 1.5x is not a surge",
  );

  const above = [...atBoundary];
  for (let i = 55; i < 60; i++) above[i] = 34;
  assertEqual(
    extractFeatures(question({ setup: setupWithCloses([], above) })).volumeSurge,
    true,
  );
});

test("extractFeatures reports zero realised volatility for a flat series", () => {
  assertEqual(extractFeatures(question()).realisedVol, 0);
});

test("extractFeatures computes realised volatility as the stdev of log returns", () => {
  // Closes alternate 100, 101, 100, 101 ... so log returns alternate +r, -r.
  const closes = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 100 : 101));
  const r = Math.log(101 / 100);
  // 59 returns alternating +r and -r: 30 of +r, 29 of -r. Mean and sample stdev
  // computed directly here rather than reimplementing the function under test.
  const returns = [];
  for (let i = 1; i < 60; i++) returns.push(Math.log(closes[i]! / closes[i - 1]!));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const expected = Math.sqrt(variance);

  assertClose(
    extractFeatures(question({ setup: setupWithCloses(closes) })).realisedVol,
    expected,
    10,
  );
  assertClose(expected, r, 3, "sanity: alternating series volatility is about r");
});

test("extractFeatures rejects a setup that is not 60 bars", () => {
  assertThrows(
    () => extractFeatures(question({ setup: setupWithCloses([]).slice(0, 59) })),
    "RangeError",
  );
  assertThrows(
    () => extractFeatures(question({ setup: [...setupWithCloses([]), bar(100)] })),
    "RangeError",
  );
});

// --- computePersona: the null paths ---

test("computePersona on no records reports everything as unavailable", () => {
  const p = computePersona([]);
  assertEqual(p.metrics.bullBias, null);
  assertEqual(p.metrics.momentumScore, null);
  assertEqual(p.metrics.volumeSensitivity, null);
  assertEqual(p.metrics.volatilitySensitivity, null);
  assertEqual(p.metrics.decisionSpeedMs, null);
  assertEqual(p.metrics.consistency, null);
  assertEqual(p.momentumAxis, null);
  assertEqual(p.biasAxis, null);
  assertEqual(p.label, null);
});

test("computePersona cannot score momentum when only one trend direction was seen", () => {
  const p = computePersona([
    rec("up", { tailTrend: 1 }),
    rec("down", { tailTrend: 1 }),
    rec("up", { tailTrend: 1 }),
  ]);
  assertEqual(p.metrics.momentumScore, null);
  assertClose(p.metrics.bullBias!, 2 / 3, 6);
});

test("computePersona ignores flat-trend records when scoring momentum", () => {
  const p = computePersona([rec("up", { tailTrend: 0 }), rec("down", { tailTrend: 0 })]);
  assertEqual(p.metrics.momentumScore, null);
});

test("computePersona cannot score volume sensitivity without both surge groups", () => {
  const p = computePersona([
    rec("up", { volumeSurge: false }),
    rec("down", { volumeSurge: false }),
  ]);
  assertEqual(p.metrics.volumeSensitivity, null);
});

test("computePersona needs four records before splitting on volatility", () => {
  const three = [
    rec("up", { realisedVol: 0.01 }),
    rec("down", { realisedVol: 0.02 }),
    rec("up", { realisedVol: 0.03 }),
  ];
  assertEqual(computePersona(three).metrics.volatilitySensitivity, null);

  const four = [...three, rec("down", { realisedVol: 0.04 })];
  assertEqual(computePersona(four).metrics.volatilitySensitivity !== null, true);
});

test("computePersona reports consistency as unavailable when every bin is tiny", () => {
  const p = computePersona([
    rec("up", { tailTrend: 1, realisedVol: 0.01 }),
    rec("down", { tailTrend: -1, realisedVol: 0.09 }),
  ]);
  assertEqual(p.metrics.consistency, null);
});

// --- computePersona: values ---

test("computePersona distinguishes a neutral momentum score from an unavailable one", () => {
  const p = computePersona([
    rec("up", { tailTrend: 1 }),
    rec("up", { tailTrend: -1 }),
  ]);
  assertEqual(p.metrics.bullBias, 1);
  assertEqual(p.metrics.momentumScore, 0, "both groups present and equal is 0, not null");
});

test("computePersona scores full momentum when the user follows every trend", () => {
  const p = computePersona([
    rec("up", { tailTrend: 1 }),
    rec("up", { tailTrend: 1 }),
    rec("down", { tailTrend: -1 }),
    rec("down", { tailTrend: -1 }),
  ]);
  assertEqual(p.metrics.momentumScore, 1);
  assertEqual(p.momentumAxis, "momentum");
});

test("computePersona scores negative momentum when the user fades every trend", () => {
  const p = computePersona([
    rec("down", { tailTrend: 1 }),
    rec("up", { tailTrend: -1 }),
  ]);
  assertEqual(p.metrics.momentumScore, -1);
  assertEqual(p.momentumAxis, "contrarian");
});

test("computePersona takes the median response time over an even count", () => {
  const p = computePersona([
    rec("up", {}, 100),
    rec("up", {}, 200),
    rec("up", {}, 300),
    rec("up", {}, 500),
  ]);
  assertEqual(p.metrics.decisionSpeedMs, 250);
});

test("computePersona takes the median response time over an odd count", () => {
  const p = computePersona([rec("up", {}, 100), rec("up", {}, 900), rec("up", {}, 300)]);
  assertEqual(p.metrics.decisionSpeedMs, 300);
});

test("computePersona averages consistency across bins without weighting by size", () => {
  // One large bin split 50/50, one small bin fully consistent.
  // Weighted would land near 0.53; unweighted must be exactly 0.75.
  const big: AnswerRecord[] = [];
  for (let i = 0; i < 15; i++) big.push(rec("up", { tailTrend: 1, realisedVol: 0.01 }));
  for (let i = 0; i < 15; i++) big.push(rec("down", { tailTrend: 1, realisedVol: 0.01 }));
  const small: AnswerRecord[] = [];
  for (let i = 0; i < 3; i++) small.push(rec("up", { tailTrend: -1, realisedVol: 0.9 }));

  const p = computePersona([...big, ...small]);
  assertClose(p.metrics.consistency!, 0.75, 6);
});

// --- axes and labels ---

function personaWith(bullBias: number, momentum: number): AnswerRecord[] {
  // 100 records: `bullBias` share are right swipes. Trend groups are arranged so
  // the momentum score comes out at the requested value.
  const out: AnswerRecord[] = [];
  const upTrendRight = Math.round(50 * (bullBias + momentum / 2));
  const downTrendRight = Math.round(50 * (bullBias - momentum / 2));
  for (let i = 0; i < 50; i++) {
    out.push(rec(i < upTrendRight ? "up" : "down", { tailTrend: 1 }));
  }
  for (let i = 0; i < 50; i++) {
    out.push(rec(i < downTrendRight ? "up" : "down", { tailTrend: -1 }));
  }
  return out;
}

test("computePersona places the momentum axis at its thresholds", () => {
  assertEqual(computePersona(personaWith(0.5, 0.15)).momentumAxis, "momentum");
  assertEqual(computePersona(personaWith(0.5, 0.14)).momentumAxis, "neutral");
  assertEqual(computePersona(personaWith(0.5, -0.15)).momentumAxis, "contrarian");
  assertEqual(computePersona(personaWith(0.5, -0.14)).momentumAxis, "neutral");
});

test("computePersona places the bias axis at its thresholds", () => {
  assertEqual(computePersona(personaWith(0.6, 0)).biasAxis, "bull");
  assertEqual(computePersona(personaWith(0.58, 0)).biasAxis, "balanced");
  assertEqual(computePersona(personaWith(0.4, 0)).biasAxis, "bear");
  assertEqual(computePersona(personaWith(0.42, 0)).biasAxis, "balanced");
  assertEqual(computePersona(personaWith(0.5, 0)).biasAxis, "balanced");
});

test("computePersona maps every axis pair to a distinct label", () => {
  const expected: Array<[number, number, string]> = [
    [0.7, 0.5, "Trend Surfer"],
    [0.5, 0.5, "Momentum Hunter"],
    [0.3, 0.5, "Breakdown Chaser"],
    [0.7, 0.0, "Optimistic Drifter"],
    [0.5, 0.0, "Coin Flipper"],
    [0.3, 0.0, "Pessimistic Drifter"],
    [0.7, -0.5, "Dip Buyer"],
    [0.5, -0.5, "Mean Reverter"],
    [0.3, -0.5, "Top Seller"],
  ];
  const seen = new Set<string>();
  for (const [bull, momentum, label] of expected) {
    const p = computePersona(personaWith(bull, momentum));
    assertEqual(p.label, label, `bull=${bull} momentum=${momentum}`);
    seen.add(label);
  }
  assertEqual(seen.size, 9, "all nine labels are distinct");
});

test("computePersona withholds the label when either axis is unavailable", () => {
  // Only one trend direction present: momentum is null, bias is not.
  const p = computePersona([rec("up", { tailTrend: 1 }), rec("up", { tailTrend: 1 })]);
  assertEqual(p.biasAxis, "bull");
  assertEqual(p.momentumAxis, null);
  assertEqual(p.label, null);
});
