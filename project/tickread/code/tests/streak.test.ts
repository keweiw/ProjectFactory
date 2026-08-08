import { test, assertEqual } from "./harness.js";
import { currentStreak, bestStreak } from "../src/streak.js";
import type { AnswerRecord, Direction } from "../src/types.js";

function record(given: Direction, correct: boolean): AnswerRecord {
  return {
    questionId: "q",
    assetClass: "equity",
    timeframe: "1d",
    horizon: 5,
    given,
    // The answer is whatever makes `correct` true or false.
    answer: correct ? given : given === "up" ? "down" : "up",
    correct,
    responseMs: 800,
    features: { tailTrend: 0, volumeSurge: false, realisedVol: 0.01 },
    ts: 0,
  };
}

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
