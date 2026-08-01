import { test, assert, assertClose, assertEqual, assertThrows } from "./harness.js";
import { wilsonInterval, classify, buildScorecard } from "../src/stats.js";
import type { AnswerRecord } from "../src/types.js";

function record(
  over: Partial<AnswerRecord> & { correct: boolean },
): AnswerRecord {
  return {
    questionId: "q",
    assetClass: "equity",
    timeframe: "1d",
    horizon: 5,
    given: "up",
    answer: over.correct ? "up" : "down",
    responseMs: 1000,
    features: { tailTrend: 1, volumeSurge: false, realisedVol: 0.01 },
    ts: 0,
    ...over,
  };
}

function records(spec: Array<[Partial<AnswerRecord>, number, number]>): AnswerRecord[] {
  // [shared fields, correct count, wrong count]
  const out: AnswerRecord[] = [];
  for (const [fields, right, wrong] of spec) {
    for (let i = 0; i < right; i++) out.push(record({ ...fields, correct: true }));
    for (let i = 0; i < wrong; i++) out.push(record({ ...fields, correct: false }));
  }
  return out;
}

// --- wilsonInterval: known-good vectors from specs/stats.md ---

const VECTORS: Array<[number, number, number, number]> = [
  [5, 10, 0.2366, 0.7634],
  [8, 10, 0.4902, 0.9433],
  [0, 10, 0.0, 0.2775],
  [10, 10, 0.7225, 1.0],
  [1, 1, 0.2065, 1.0],
];

for (const [s, n, low, high] of VECTORS) {
  test(`wilsonInterval ${s}/${n} matches the known interval`, () => {
    const i = wilsonInterval(s, n);
    assertClose(i.low, low, 4, "low");
    assertClose(i.high, high, 4, "high");
  });
}

test("wilsonInterval with zero trials spans the whole range", () => {
  assertEqual(wilsonInterval(0, 0), { low: 0, high: 1 });
});

test("wilsonInterval bounds never escape [0,1]", () => {
  for (let n = 1; n <= 200; n++) {
    for (const s of [0, 1, Math.floor(n / 2), n]) {
      const i = wilsonInterval(s, n);
      assert(i.low >= 0 && i.low <= 1, `low out of range at ${s}/${n}: ${i.low}`);
      assert(i.high >= 0 && i.high <= 1, `high out of range at ${s}/${n}: ${i.high}`);
      assert(i.low <= i.high, `inverted interval at ${s}/${n}`);
    }
  }
});

test("wilsonInterval narrows as the sample grows at fixed accuracy", () => {
  const w = (s: number, n: number) => {
    const i = wilsonInterval(s, n);
    return i.high - i.low;
  };
  assert(w(5, 10) > w(50, 100), "10 -> 100 should narrow");
  assert(w(50, 100) > w(500, 1000), "100 -> 1000 should narrow");
});

test("wilsonInterval rejects impossible inputs", () => {
  assertThrows(() => wilsonInterval(11, 10), "RangeError", "successes > trials");
  assertThrows(() => wilsonInterval(-1, 10), "RangeError", "negative successes");
  assertThrows(() => wilsonInterval(1, -10), "RangeError", "negative trials");
  assertThrows(() => wilsonInterval(1.5, 10), "RangeError", "non-integer successes");
});

// --- classify: the honesty gate ---

test("classify needs the interval to clear 0.5 strictly", () => {
  assertEqual(classify({ low: 0.5, high: 0.9 }, 20), "inconclusive", "low exactly 0.5");
  assertEqual(classify({ low: 0.1, high: 0.5 }, 20), "inconclusive", "high exactly 0.5");
  assertEqual(classify({ low: 0.5001, high: 0.9 }, 20), "strength");
  assertEqual(classify({ low: 0.1, high: 0.4999 }, 20), "weakness");
});

test("classify needs at least 8 samples", () => {
  assertEqual(classify({ low: 0.6, high: 0.9 }, 7), "inconclusive");
  assertEqual(classify({ low: 0.6, high: 0.9 }, 8), "strength");
  assertEqual(classify({ low: 0.1, high: 0.4 }, 7), "inconclusive");
  assertEqual(classify({ low: 0.1, high: 0.4 }, 8), "weakness");
});

test("classify calls a straddling interval inconclusive at any sample size", () => {
  assertEqual(classify({ low: 0.3, high: 0.7 }, 1000), "inconclusive");
});

// --- buildScorecard ---

test("buildScorecard on no records returns a valid empty shape", () => {
  const s = buildScorecard([]);
  assertEqual(s.overall.total, 0);
  assertEqual(s.overall.correct, 0);
  assertEqual(s.overall.accuracy, 0);
  assertEqual(s.overall.interval, { low: 0, high: 1 });
  assertEqual(s.overall.significance, "inconclusive");
  assertEqual(s.byAssetClass, []);
  assertEqual(s.byTimeframe, []);
  assertEqual(s.byHorizon, []);
});

test("buildScorecard computes overall accuracy", () => {
  const s = buildScorecard(records([[{}, 7, 3]]));
  assertEqual(s.overall.correct, 7);
  assertEqual(s.overall.total, 10);
  assertClose(s.overall.accuracy, 0.7);
});

test("buildScorecard emits no rows for buckets with no records", () => {
  const s = buildScorecard(records([[{ assetClass: "crypto" }, 3, 1]]));
  assertEqual(s.byAssetClass.length, 1);
  assertEqual(s.byAssetClass[0]!.key, "crypto");
});

test("buildScorecard bucket totals sum to the overall total per dimension", () => {
  const s = buildScorecard(
    records([
      [{ assetClass: "equity", timeframe: "1d", horizon: 1 }, 4, 2],
      [{ assetClass: "crypto", timeframe: "1m", horizon: 20 }, 1, 5],
      [{ assetClass: "future", timeframe: "1mo", horizon: 5 }, 3, 3],
    ]),
  );
  const sum = (rows: { total: number }[]) => rows.reduce((a, r) => a + r.total, 0);
  assertEqual(sum(s.byAssetClass), s.overall.total, "asset class");
  assertEqual(sum(s.byTimeframe), s.overall.total, "timeframe");
  assertEqual(sum(s.byHorizon), s.overall.total, "horizon");
});

test("buildScorecard uses a fixed presentation order, not count order", () => {
  const raw = records([
    [{ assetClass: "crypto", timeframe: "1mo", horizon: 20 }, 9, 0],
    [{ assetClass: "equity", timeframe: "1m", horizon: 1 }, 1, 0],
    [{ assetClass: "future", timeframe: "1h", horizon: 5 }, 4, 0],
  ]);
  // Shuffled input must not change output order.
  const s = buildScorecard([...raw].reverse());
  assertEqual(
    s.byAssetClass.map((r) => r.key),
    ["equity", "future", "crypto"],
  );
  assertEqual(
    s.byTimeframe.map((r) => r.key),
    ["1m", "1h", "1mo"],
  );
  assertEqual(
    s.byHorizon.map((r) => r.key),
    ["1", "5", "20"],
  );
});

test("buildScorecard marks a clearly strong bucket as a strength", () => {
  const s = buildScorecard(records([[{ timeframe: "1mo" }, 20, 0]]));
  assertEqual(s.byTimeframe[0]!.significance, "strength");
});

test("buildScorecard leaves a small bucket inconclusive however good it looks", () => {
  const s = buildScorecard(records([[{ timeframe: "1mo" }, 5, 0]]));
  assertEqual(s.byTimeframe[0]!.total, 5);
  assertEqual(s.byTimeframe[0]!.significance, "inconclusive");
});
