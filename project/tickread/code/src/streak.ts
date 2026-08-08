/**
 * Consecutive-hit counting.
 *
 * This began as a tape — a glyph per answer showing the call and the outcome —
 * and the glyphs were removed deliberately. A strip reading ▲▲▲▼ mid-round shows
 * the player their own directional bias while they still have questions left, so
 * they start correcting for it, and bullBias, momentumScore and consistency end
 * up measuring the interface rather than the person. Ten answers is nowhere near
 * enough to absorb that.
 *
 * A streak carries no directional information — it cannot push anyone toward up
 * or down — so it is safe to show while a round is running.
 *
 * Pure, no DOM.
 */

import type { AnswerRecord } from "./types.js";

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

/**
 * The longest run of consecutive hits anywhere in the records.
 *
 * Not rendered yet. It belongs in the round report, which is retrospective and so
 * cannot bias an answer that has already been given.
 */
export function bestStreak(records: readonly AnswerRecord[]): number {
  let best = 0;
  let run = 0;
  for (const record of records) {
    run = record.correct ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}
