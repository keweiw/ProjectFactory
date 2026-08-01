/**
 * One round's state. Pure, DOM-free.
 *
 * Transitions return new objects rather than mutating, which keeps a round
 * trivially testable and makes an accidental double-submit from the gesture
 * handler harmless rather than corrupting. See specs/session.md.
 */

import { extractFeatures } from "./persona.js";
import type { AnswerRecord, Direction, Question, SessionState } from "./types.js";

export function createSession(questions: readonly Question[]): SessionState {
  // Copied so a caller mutating the array afterwards cannot change a round in flight.
  return { questions: [...questions], index: 0, records: [] };
}

export function isFinished(state: SessionState): boolean {
  return state.index >= state.questions.length;
}

export function currentQuestion(state: SessionState): Question | null {
  return isFinished(state) ? null : state.questions[state.index]!;
}

export function progress(state: SessionState): { answered: number; total: number } {
  return { answered: state.records.length, total: state.questions.length };
}

export function answer(
  state: SessionState,
  given: Direction,
  responseMs: number,
  now: () => number = Date.now,
): SessionState {
  const question = currentQuestion(state);
  if (question === null) {
    throw new RangeError("answer called on a finished session");
  }

  const record: AnswerRecord = {
    questionId: question.id,
    assetClass: question.assetClass,
    timeframe: question.timeframe,
    horizon: question.horizon,
    given,
    answer: question.answer,
    correct: given === question.answer,
    // A clock adjustment mid-round can produce a negative reading; letting it
    // through would poison the median response time.
    responseMs: Math.max(0, responseMs),
    features: extractFeatures(question),
    ts: now(),
  };

  return {
    questions: state.questions,
    index: state.index + 1,
    records: [...state.records, record],
  };
}
