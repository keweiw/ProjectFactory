import { test, assertEqual, assertThrows } from "./harness.js";
import {
  createSession,
  currentQuestion,
  isFinished,
  answer,
  progress,
} from "../src/session.js";
import { extractFeatures } from "../src/persona.js";
import type { Bar, Direction, Question } from "../src/types.js";

function flatSetup(): Bar[] {
  return Array.from({ length: 60 }, () => ({ o: 100, h: 100, l: 100, c: 100, v: 1000 }));
}

function question(id: string, truth: Direction): Question {
  return {
    id,
    assetClass: "equity",
    timeframe: "1d",
    horizon: 5,
    setup: flatSetup(),
    future: [{ o: 100, h: 101, l: 99, c: truth === "up" ? 101 : 99, v: 1000 }],
    answer: truth,
  };
}

const clock = () => 12345;

test("createSession starts at the first question with no records", () => {
  const s = createSession([question("a", "up"), question("b", "down")]);
  assertEqual(s.index, 0);
  assertEqual(s.records, []);
  assertEqual(currentQuestion(s)!.id, "a");
  assertEqual(isFinished(s), false);
  assertEqual(progress(s), { answered: 0, total: 2 });
});

test("answer advances to the next question", () => {
  let s = createSession([question("a", "up"), question("b", "down")]);
  s = answer(s, "up", 500, clock);
  assertEqual(s.index, 1);
  assertEqual(currentQuestion(s)!.id, "b");
  assertEqual(progress(s), { answered: 1, total: 2 });
});

test("answer finishes the session after the last question", () => {
  let s = createSession([question("a", "up")]);
  s = answer(s, "up", 500, clock);
  assertEqual(isFinished(s), true);
  assertEqual(currentQuestion(s), null);
});

test("answer marks a matching swipe correct and a mismatching one wrong", () => {
  const cases: Array<[Direction, Direction, boolean]> = [
    ["up", "up", true],
    ["up", "down", false],
    ["down", "down", true],
    ["down", "up", false],
  ];
  for (const [given, truth, expected] of cases) {
    const s = answer(createSession([question("a", truth)]), given, 500, clock);
    assertEqual(s.records[0]!.correct, expected, `given ${given}, truth ${truth}`);
    assertEqual(s.records[0]!.given, given);
    assertEqual(s.records[0]!.answer, truth);
  }
});

test("answer stores the question's extracted features on the record", () => {
  const q = question("a", "up");
  const s = answer(createSession([q]), "up", 500, clock);
  assertEqual(s.records[0]!.features, extractFeatures(q));
});

test("answer copies the question's classification onto the record", () => {
  const q: Question = { ...question("a", "up"), assetClass: "crypto", timeframe: "1m", horizon: 20 };
  const s = answer(createSession([q]), "up", 500, clock);
  assertEqual(s.records[0]!.questionId, "a");
  assertEqual(s.records[0]!.assetClass, "crypto");
  assertEqual(s.records[0]!.timeframe, "1m");
  assertEqual(s.records[0]!.horizon, 20);
});

test("answer uses the injected clock for the timestamp", () => {
  const s = answer(createSession([question("a", "up")]), "up", 500, clock);
  assertEqual(s.records[0]!.ts, 12345);
});

test("answer does not mutate the state it was given", () => {
  const before = createSession([question("a", "up"), question("b", "up")]);
  answer(before, "up", 500, clock);
  assertEqual(before.index, 0);
  assertEqual(before.records.length, 0);
});

test("answer refuses to advance past the end", () => {
  const s = answer(createSession([question("a", "up")]), "up", 500, clock);
  assertThrows(() => answer(s, "up", 500, clock), "RangeError");
});

test("answer clamps a negative response time to zero", () => {
  const s = answer(createSession([question("a", "up")]), "up", -200, clock);
  assertEqual(s.records[0]!.responseMs, 0);
});

test("createSession on an empty list is immediately finished", () => {
  const s = createSession([]);
  assertEqual(isFinished(s), true);
  assertEqual(currentQuestion(s), null);
  assertEqual(progress(s), { answered: 0, total: 0 });
});

test("createSession copies the input so later mutation cannot change the round", () => {
  const input = [question("a", "up")];
  const s = createSession(input);
  input.push(question("b", "up"));
  assertEqual(progress(s).total, 1);
});

test("a full round records every answer in order", () => {
  let s = createSession([question("a", "up"), question("b", "down"), question("c", "up")]);
  s = answer(s, "up", 100, clock);
  s = answer(s, "up", 200, clock);
  s = answer(s, "up", 300, clock);
  assertEqual(isFinished(s), true);
  assertEqual(
    s.records.map((r) => r.questionId),
    ["a", "b", "c"],
  );
  assertEqual(
    s.records.map((r) => r.correct),
    [true, false, true],
  );
});
