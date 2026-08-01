/**
 * Scorecard statistics. Pure, DOM-free.
 *
 * This module carries the product's honesty constraint: a bucket is only called a
 * strength or a weakness when the sample actually supports it. See specs/stats.md.
 */

import {
  ASSET_CLASS_ORDER,
  HORIZON_ORDER,
  TIMEFRAME_ORDER,
  type AnswerRecord,
  type BucketStat,
  type Interval,
  type Scorecard,
  type Significance,
} from "./types.js";

const DEFAULT_Z = 1.96;

/** Minimum sample before a bucket may be called a strength or a weakness. */
export const MIN_SAMPLE = 8;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Wilson score interval for a binomial proportion.
 *
 * Preferred over the normal approximation because it stays inside [0, 1] and
 * behaves sensibly at the extremes — which is exactly where a 20-question round
 * lands most of its buckets.
 */
export function wilsonInterval(successes: number, trials: number, z = DEFAULT_Z): Interval {
  if (!Number.isInteger(successes) || !Number.isInteger(trials)) {
    throw new RangeError(`wilsonInterval needs integers, got ${successes}/${trials}`);
  }
  if (successes < 0 || trials < 0) {
    throw new RangeError(`wilsonInterval needs non-negative counts, got ${successes}/${trials}`);
  }
  if (successes > trials) {
    throw new RangeError(`wilsonInterval got more successes than trials: ${successes}/${trials}`);
  }
  if (trials === 0) return { low: 0, high: 1 };

  const n = trials;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));

  return { low: clamp01(centre - margin), high: clamp01(centre + margin) };
}

/**
 * Comparisons are strict: an interval whose bound lands exactly on 0.5 has not
 * cleared it. Changing MIN_SAMPLE or the confidence level is a product decision,
 * not an implementation detail — see DESIGN.md.
 */
export function classify(interval: Interval, total: number): Significance {
  if (total < MIN_SAMPLE) return "inconclusive";
  if (interval.low > 0.5) return "strength";
  if (interval.high < 0.5) return "weakness";
  return "inconclusive";
}

function toBucket(key: string, records: readonly AnswerRecord[]): BucketStat {
  const total = records.length;
  let correct = 0;
  for (const r of records) if (r.correct) correct++;
  const interval = wilsonInterval(correct, total);
  return {
    key,
    correct,
    total,
    accuracy: total === 0 ? 0 : correct / total,
    interval,
    significance: classify(interval, total),
  };
}

/**
 * Groups into one bucket per *observed* key. Empty buckets are not emitted — the
 * report must not show rows for asset classes the question bank never covered.
 */
function group(
  records: readonly AnswerRecord[],
  keyOf: (r: AnswerRecord) => string,
  order: readonly string[],
): BucketStat[] {
  const groups = new Map<string, AnswerRecord[]>();
  for (const r of records) {
    const key = keyOf(r);
    const existing = groups.get(key);
    if (existing) existing.push(r);
    else groups.set(key, [r]);
  }

  // Fixed presentation order keeps the report stable between rounds instead of
  // reshuffling as counts change. Unknown keys sort last, alphabetically.
  const rank = (key: string): number => {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };

  return [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((key) => toBucket(key, groups.get(key)!));
}

const HORIZON_KEY_ORDER = HORIZON_ORDER.map(String);

export function buildScorecard(records: readonly AnswerRecord[]): Scorecard {
  return {
    overall: toBucket("overall", records),
    byAssetClass: group(records, (r) => r.assetClass, ASSET_CLASS_ORDER),
    byTimeframe: group(records, (r) => r.timeframe, TIMEFRAME_ORDER),
    byHorizon: group(records, (r) => String(r.horizon), HORIZON_KEY_ORDER),
  };
}
