/**
 * The tape: one glyph per answer, read left to right, the way a tape reader would.
 *
 * Shape carries the call and fill carries the outcome, so the strip stays readable
 * with no colour at all. Colour only ever reinforces — the same discipline the
 * report visualisations already follow, and for the same reason.
 *
 * Pure, no DOM. `app.ts` turns these descriptors into markup.
 */

import type { AnswerRecord, Direction } from "./types.js";

export interface TapeGlyph {
  /** The direction the player called. */
  call: Direction;
  /** Whether that call turned out to be right. */
  hit: boolean;
}

/** One glyph per answered question, in the order they were answered. */
export function tapeGlyphs(records: readonly AnswerRecord[]): TapeGlyph[] {
  return records.map((record) => ({ call: record.given, hit: record.correct }));
}

/**
 * Consecutive hits ending at the most recent answer, so a miss visibly resets it.
 * 0 when the last answer was wrong, and 0 when nothing has been answered.
 */
export function currentStreak(records: readonly AnswerRecord[]): number {
  let streak = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (!records[i]!.correct) break;
    streak++;
  }
  return streak;
}

/** The longest run of consecutive hits anywhere in the records. */
export function bestStreak(records: readonly AnswerRecord[]): number {
  let best = 0;
  let run = 0;
  for (const record of records) {
    run = record.correct ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}
