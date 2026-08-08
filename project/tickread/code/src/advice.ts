/**
 * Turns the scorecard into a verdict a human would repeat to a friend.
 *
 * This module is where the product is most tempted to lie. "You are a monthly
 * trader" is a far more satisfying thing to read than "not enough data", and it is
 * one line of code away. So the gate is the same one `stats.ts` enforces and
 * DESIGN.md calls non-negotiable: **nothing is claimed until a bucket has at least
 * MIN_SAMPLE answers and its 95% interval excludes 50%.** Until then the verdict
 * says so, and shows how far off it is.
 *
 * Pure and DOM-free. See specs/advice.md.
 */

import { isAskable } from "./deck.js";
import { classify, MIN_SAMPLE, wilsonInterval } from "./stats.js";
import {
  HORIZON_ORDER,
  TIMEFRAME_ORDER,
  type AnswerRecord,
  type BucketStat,
  type Horizon,
  type PersonaMetrics,
  type PersonaResult,
  type Scorecard,
  type Timeframe,
} from "./types.js";

/** Past this there is no point projecting; the edge is indistinguishable from luck. */
const PROJECTION_CEILING = 2000;

export interface AdviceProgress {
  /** Answers recorded so far. */
  answers: number;
  /** Answers needed before the interval would clear 50%, or null if it never would. */
  target: number | null;
  /** Whole rounds still to play to reach `target`, or null when `target` is null. */
  roundsLeft: number | null;
}

export interface Advice {
  title: string;
  body: string;
  suggestion: string | null;
  /** Present only while unsettled — the honest "not yet" state. */
  progress: AdviceProgress | null;
  settled: boolean;
}

/**
 * The smallest sample at which an accuracy of `accuracy` would clear 50%.
 *
 * Answers "how much longer?" from the user's *own* observed rate rather than a
 * fixed number, because the honest answer genuinely depends on it: at 90% the
 * interval clears in a couple of rounds, at 55% it takes hundreds of answers, and
 * at exactly 50% it never clears at all. Returns null for that last case, which is
 * a finding in itself rather than a failure.
 */
export function answersNeededForVerdict(accuracy: number, from: number): number | null {
  if (!Number.isFinite(accuracy)) return null;
  const start = Math.max(1, Math.floor(from));
  for (let n = start; n <= PROJECTION_CEILING; n++) {
    const successes = Math.round(accuracy * n);
    if (successes < 0 || successes > n) return null;
    const interval = wilsonInterval(successes, n);
    if (interval.low > 0.5 || interval.high < 0.5) return n;
  }
  return null;
}

// `roundAccuracies` lived here, feeding a round-by-round line in the report. Both
// are gone: at ten answers a round, the line plotted sampling noise as form. See the
// note where the chart used to be in `report-view.ts`.

// --- the character sheet -----------------------------------------------------

export interface ShapeAxis {
  label: string;
  /** 0..1, where 0.5 is the neutral middle of that axis. */
  value: number;
  /** True when the metric was null and 0.5 is a placeholder, not a measurement. */
  unknown: boolean;
}

/**
 * The four persona axes normalised onto a common 0..1 scale, in a fixed order so
 * the resulting radar outline is a stable "shape" for a given player — the same
 * decisions always draw the same silhouette.
 *
 * A null metric plots at the centre and is flagged `unknown`. Rendering it as a
 * measured 0.5 without the flag would state a finding the sample cannot support.
 */
export function personaShape(metrics: PersonaMetrics): ShapeAxis[] {
  const bipolar = (v: number | null): { value: number; unknown: boolean } =>
    v === null ? { value: 0.5, unknown: true } : { value: (Math.max(-1, Math.min(1, v)) + 1) / 2, unknown: false };
  const unit = (v: number | null): { value: number; unknown: boolean } =>
    v === null ? { value: 0.5, unknown: true } : { value: Math.max(0, Math.min(1, v)), unknown: false };

  return [
    { label: "Bullish", ...unit(metrics.bullBias) },
    { label: "Momentum", ...bipolar(metrics.momentumScore) },
    { label: "Volume", ...bipolar(metrics.volumeSensitivity) },
    { label: "Volatility", ...bipolar(metrics.volatilitySensitivity) },
  ];
}

export interface Grade {
  letter: string;
  /** True while the sample cannot support the grade — it is a tease, not a finding. */
  provisional: boolean;
}

const GRADE_BANDS: ReadonlyArray<readonly [number, string]> = [
  [0.75, "S"],
  [0.65, "A"],
  [0.55, "B"],
  [0.45, "C"],
  [0.35, "D"],
];

/**
 * A letter grade, because a game needs one.
 *
 * `provisional` is the honest half: until the interval clears 50% the letter is
 * decoration and the report must say so. It is never silently promoted to a claim.
 */
export function gradeFor(overall: BucketStat): Grade {
  const provisional = overall.significance === "inconclusive";
  if (overall.total === 0) return { letter: "–", provisional: true };
  for (const [floor, letter] of GRADE_BANDS) {
    if (overall.accuracy >= floor) return { letter, provisional };
  }
  return { letter: "F", provisional };
}

export type SkillState = "locked" | "open" | "cleared" | "failed" | "unasked";

export interface SkillCell {
  timeframe: Timeframe;
  horizon: Horizon;
  total: number;
  correct: number;
  accuracy: number | null;
  state: SkillState;
}

/**
 * The twelve timeframe x horizon cells as a map to be uncovered.
 *
 * This is the significance rule wearing a game mechanic. A cell you have not
 * answered enough of is `locked` — not "50%", not an empty bar, but explicitly
 * unknown, with the answers still needed. The statistical gate and the fog of war
 * turn out to be the same idea, which is why this reads as a reward rather than as
 * the report refusing to talk.
 *
 * All twelve are still returned even though one is never asked, so the grid keeps its
 * shape. That one comes back `unasked`, which is a different thing from `locked`:
 * locked is "you have not done this yet", unasked is "this is not on the map". Giving
 * it the locked treatment would set the player chasing a square that can never open.
 */
export function skillGrid(records: readonly AnswerRecord[]): SkillCell[] {
  const cells: SkillCell[] = [];
  for (const timeframe of TIMEFRAME_ORDER) {
    for (const horizon of HORIZON_ORDER) {
      if (!isAskable(timeframe, horizon)) {
        cells.push({
          timeframe, horizon, total: 0, correct: 0, accuracy: null, state: "unasked",
        });
        continue;
      }
      const hits = records.filter((r) => r.timeframe === timeframe && r.horizon === horizon);
      const total = hits.length;
      const correct = hits.filter((r) => r.correct).length;
      const significance = total === 0 ? "inconclusive" : classify(wilsonInterval(correct, total), total);
      const state: SkillState =
        total === 0
          ? "locked"
          : significance === "strength"
            ? "cleared"
            : significance === "weakness"
              ? "failed"
              : "open";
      cells.push({
        timeframe,
        horizon,
        total,
        correct,
        accuracy: total === 0 ? null : correct / total,
        state,
      });
    }
  }
  return cells;
}

/** Answers still needed in a cell before it could possibly be called. */
export function answersToUnlock(cell: SkillCell): number {
  return Math.max(0, MIN_SAMPLE - cell.total);
}

const TIMEFRAME_WORDS: Record<string, string> = {
  "1m": "1-minute",
  "1h": "hourly",
  "1d": "daily",
  "1mo": "monthly",
};

const ASSET_WORDS: Record<string, string> = {
  equity: "US equity",
  etf_index: "ETF / index",
  future: "futures",
  crypto: "crypto",
};

const HORIZON_WORDS: Record<string, string> = {
  "1": "next-bar",
  "5": "five-bar",
  "20": "twenty-bar",
};

/** A bucket key rendered for prose. Falls back to the raw key rather than "undefined". */
function wordFor(bucket: BucketStat): string {
  return (
    TIMEFRAME_WORDS[bucket.key] ?? ASSET_WORDS[bucket.key] ?? HORIZON_WORDS[bucket.key] ?? bucket.key
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function significant(buckets: readonly BucketStat[], kind: "strength" | "weakness"): BucketStat[] {
  return buckets.filter((b) => b.significance === kind).sort((a, b) => b.total - a.total);
}

function allBuckets(scorecard: Scorecard): BucketStat[] {
  return [...scorecard.byTimeframe, ...scorecard.byAssetClass, ...scorecard.byHorizon];
}

/**
 * The verdict. `roundSize` is passed in rather than imported so this module stays
 * free of `deck.ts` and its fetch surface.
 */
export function buildAdvice(
  scorecard: Scorecard,
  persona: PersonaResult,
  roundSize: number,
): Advice {
  const overall = scorecard.overall;
  const strengths = significant(allBuckets(scorecard), "strength");
  const weaknesses = significant(allBuckets(scorecard), "weakness");

  // --- settled: the overall record itself cleared the bar ---

  if (overall.significance === "weakness") {
    const worst = weaknesses[0];
    return {
      title: "The Reverse Indicator",
      body:
        `${overall.correct} of ${overall.total}, with a 95% range of ` +
        `${percent(overall.interval.low)}–${percent(overall.interval.high)}. That is not a cold ` +
        `streak — it clears the significance bar from below, which means you are wrong ` +
        `dependably. Dependable is a signal. The problem is that acting on it costs spread.`,
      suggestion: worst
        ? `Your flattest read is ${wordFor(worst)} (${percent(worst.accuracy)} over ${worst.total}). ` +
          `Whatever those charts make you feel, the tape has been doing the opposite.`
        : "Try reading the next twenty the way you would if a friend had asked for the opposite call.",
      progress: null,
      settled: true,
    };
  }

  if (overall.significance === "strength") {
    const best = strengths[0];
    return {
      title: "Reads the Tape",
      body:
        `${overall.correct} of ${overall.total}, 95% range ` +
        `${percent(overall.interval.low)}–${percent(overall.interval.high)}. The range clears a ` +
        `coin flip, so this is an edge rather than a good week.`,
      suggestion: best
        ? `It is strongest on ${wordFor(best)} charts — ${percent(best.accuracy)} over ${best.total} answers.`
        : `It is spread evenly rather than concentrated in one corner of the matrix.`,
      progress: null,
      settled: true,
    };
  }

  // --- settled: overall is a coin flip, but one corner of the matrix is not ---

  if (strengths.length > 0) {
    const best = strengths[0]!;
    return {
      title: `A ${wordFor(best)} Specialist`,
      body:
        `Overall you are a coin flip, which is the honest baseline. But on ${wordFor(best)} ` +
        `you are ${percent(best.accuracy)} over ${best.total} answers, and that range clears 50% ` +
        `on its own. The average is hiding a real edge.`,
      suggestion: `Play to it. Everything outside ${wordFor(best)} is currently costing you the average.`,
      progress: null,
      settled: true,
    };
  }

  if (weaknesses.length > 0) {
    const worst = weaknesses[0]!;
    return {
      title: `Blind Spot: ${wordFor(worst)}`,
      body:
        `Overall you are a coin flip. ${wordFor(worst)} is not — you are ` +
        `${percent(worst.accuracy)} there over ${worst.total} answers, and that range clears 50% ` +
        `from the wrong side. One bucket is dragging an otherwise even record.`,
      suggestion: `Sit out ${wordFor(worst)} for a while and the average should look after itself.`,
      progress: null,
      settled: true,
    };
  }

  // --- unsettled: say so, and say how far off ---

  const target = answersNeededForVerdict(overall.accuracy, Math.max(1, overall.total));
  const remaining = target === null ? null : Math.max(0, target - overall.total);
  const roundsLeft =
    remaining === null ? null : Math.max(1, Math.ceil(remaining / Math.max(1, roundSize)));

  const progress: AdviceProgress = { answers: overall.total, target, roundsLeft };

  if (overall.total === 0) {
    return {
      title: "No verdict yet",
      body:
        "Nothing has been answered yet, so there is nothing to claim. Play a round and this " +
        "turns into a real reading.",
      suggestion: null,
      progress,
      settled: false,
    };
  }

  if (target === null) {
    return {
      title: "No verdict yet",
      body:
        `${overall.correct} of ${overall.total} is close enough to an exact coin flip that the ` +
        `confidence range will never clear 50%, no matter how long you keep going. That is itself ` +
        `the finding: on these charts, at this sample, you are indistinguishable from chance.`,
      suggestion:
        persona.label !== null
          ? `Your decisions are consistent, though — the profile below reads as "${persona.label}". ` +
            `How you decide is settled well before whether it works.`
          : null,
      progress,
      settled: false,
    };
  }

  return {
    title: "No verdict yet",
    body:
      `${overall.total} answers in at ${percent(overall.accuracy)}. Nothing here has cleared the ` +
      `bar — a bucket needs at least 8 answers and a confidence range that excludes 50% before ` +
      `this report will call it anything. At your current rate that lands around ${target} answers.`,
    suggestion:
      roundsLeft === null
        ? null
        : `About ${roundsLeft} more ${roundsLeft === 1 ? "round" : "rounds"} and this section ` +
          `should have something to say.`,
    progress,
    settled: false,
  };
}
