import { test, assertEqual } from "./harness.js";
import { tapeGlyphs, currentStreak, bestStreak } from "../src/tape.js";
import type { AnswerRecord, Direction } from "../src/types.js";

function record(given: Direction, correct: boolean): AnswerRecord {
  return {
    questionId: "q",
    assetClass: "equity",
    timeframe: "1d",
    horizon: 5,
    given,
    // The answer is whatever makes `correct` true or false, since the tape only
    // ever reads the call and the outcome.
    answer: correct ? given : given === "up" ? "down" : "up",
    correct,
    responseMs: 800,
    features: { tailTrend: 0, volumeSurge: false, realisedVol: 0.01 },
    ts: 0,
  };
}

// --- glyphs ---

test("tapeGlyphs is empty for no records", () => {
  assertEqual(tapeGlyphs([]), []);
});

test("tapeGlyphs carries the call and the outcome separately", () => {
  assertEqual(tapeGlyphs([record("up", true), record("down", false)]), [
    { call: "up", hit: true },
    { call: "down", hit: false },
  ]);
});

test("tapeGlyphs distinguishes all four call and outcome pairs", () => {
  const records = [
    record("up", true),
    record("up", false),
    record("down", true),
    record("down", false),
  ];
  assertEqual(tapeGlyphs(records), [
    { call: "up", hit: true },
    { call: "up", hit: false },
    { call: "down", hit: true },
    { call: "down", hit: false },
  ]);
});

test("tapeGlyphs preserves the order answers were given in", () => {
  const records = [record("down", false), record("up", true), record("down", true)];
  assertEqual(
    tapeGlyphs(records).map((g) => g.call),
    ["down", "up", "down"],
  );
});

// --- streaks ---

test("currentStreak is 0 for no records", () => {
  assertEqual(currentStreak([]), 0);
});

test("currentStreak counts consecutive hits at the end", () => {
  assertEqual(currentStreak([record("up", true), record("up", true)]), 2);
});

test("currentStreak is 0 when the most recent answer missed", () => {
  assertEqual(currentStreak([record("up", true), record("up", false)]), 0);
});

test("currentStreak counts only the run at the end, not every hit", () => {
  const records = [
    record("up", true),
    record("up", true),
    record("down", false),
    record("up", true),
  ];
  assertEqual(currentStreak(records), 1);
});

test("bestStreak is 0 when nothing was ever right", () => {
  assertEqual(bestStreak([record("up", false), record("down", false)]), 0);
});

test("bestStreak finds the longest run anywhere, not the last one", () => {
  const records = [
    record("up", true),
    record("up", true),
    record("up", true),
    record("down", false),
    record("up", true),
  ];
  assertEqual(bestStreak(records), 3);
});

test("bestStreak equals currentStreak when the run reaches the end", () => {
  const records = [record("up", false), record("up", true), record("up", true)];
  assertEqual(bestStreak(records), 2);
  assertEqual(currentStreak(records), 2);
});
