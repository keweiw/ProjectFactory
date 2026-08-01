/**
 * Behavioural profile. Pure, DOM-free.
 *
 * None of these metrics depend on being right, so the profile is meaningful from
 * the first round — unlike the scorecard, which needs volume before it can say
 * anything.
 *
 * A metric is `null` when the sample cannot support it. `null` and `0` mean
 * genuinely different things and must never be conflated: `0` is "you showed no
 * tendency", `null` is "there was nothing to measure". Reporting the second as the
 * first would invent a personality out of an empty sample. See specs/persona.md.
 */

import {
  SETUP_LENGTH,
  type AnswerRecord,
  type BiasAxis,
  type MomentumAxis,
  type PersonaResult,
  type Question,
  type QuestionFeatures,
} from "./types.js";

const TAIL_WINDOW = 10;
const VOLUME_WINDOW = 5;
const VOLUME_SURGE_RATIO = 1.5;
const MIN_CONSISTENCY_BIN = 3;
const MIN_VOLATILITY_SPLIT = 4;

export const MOMENTUM_THRESHOLD = 0.15;
export const BULL_THRESHOLD = 0.6;
export const BEAR_THRESHOLD = 0.4;

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function sampleStdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function extractFeatures(question: Question): QuestionFeatures {
  const setup = question.setup;
  if (setup.length !== SETUP_LENGTH) {
    throw new RangeError(`extractFeatures needs ${SETUP_LENGTH} setup bars, got ${setup.length}`);
  }

  // Computed rather than using Math.sign, which returns -0 for a negative zero and
  // would not compare equal to the 0 the type promises.
  const drift = setup[SETUP_LENGTH - 1]!.c - setup[SETUP_LENGTH - 1 - TAIL_WINDOW]!.c;
  const tailTrend: -1 | 0 | 1 = drift > 0 ? 1 : drift < 0 ? -1 : 0;

  const tailVolume = mean(setup.slice(-VOLUME_WINDOW).map((b) => b.v));
  const allVolume = mean(setup.map((b) => b.v));

  const returns: number[] = [];
  for (let i = 1; i < setup.length; i++) {
    returns.push(Math.log(setup[i]!.c / setup[i - 1]!.c));
  }

  return {
    tailTrend,
    volumeSurge: tailVolume > VOLUME_SURGE_RATIO * allVolume,
    realisedVol: sampleStdev(returns),
  };
}

/** Share of right swipes, or null when the group is empty. */
function rightRate(records: readonly AnswerRecord[]): number | null {
  if (records.length === 0) return null;
  let right = 0;
  for (const r of records) if (r.given === "up") right++;
  return right / records.length;
}

/** Difference in right-swipe rate between two groups; null if either is empty. */
function rateDifference(
  a: readonly AnswerRecord[],
  b: readonly AnswerRecord[],
): number | null {
  const ra = rightRate(a);
  const rb = rightRate(b);
  return ra === null || rb === null ? null : ra - rb;
}

/** Tercile index 0, 1 or 2 of each record's realised volatility within this set. */
function volatilityTerciles(records: readonly AnswerRecord[]): (r: AnswerRecord) => number {
  const sorted = records.map((r) => r.features.realisedVol).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 3)]!;
  const q2 = sorted[Math.floor((2 * sorted.length) / 3)]!;
  return (r) => (r.features.realisedVol <= q1 ? 0 : r.features.realisedVol <= q2 ? 1 : 2);
}

/**
 * Bins by trend direction and volatility tercile, then averages how lopsided each
 * bin's answers were. Unweighted, so one large bin cannot drown out the rest.
 */
function computeConsistency(records: readonly AnswerRecord[]): number | null {
  if (records.length === 0) return null;
  const tercileOf = volatilityTerciles(records);

  const bins = new Map<string, AnswerRecord[]>();
  for (const r of records) {
    const key = `${r.features.tailTrend}|${tercileOf(r)}`;
    const existing = bins.get(key);
    if (existing) existing.push(r);
    else bins.set(key, [r]);
  }

  const shares: number[] = [];
  for (const bin of bins.values()) {
    if (bin.length < MIN_CONSISTENCY_BIN) continue;
    let up = 0;
    for (const r of bin) if (r.given === "up") up++;
    shares.push(Math.max(up, bin.length - up) / bin.length);
  }

  return shares.length === 0 ? null : mean(shares);
}

function momentumAxisOf(score: number | null): MomentumAxis | null {
  if (score === null) return null;
  if (score >= MOMENTUM_THRESHOLD) return "momentum";
  if (score <= -MOMENTUM_THRESHOLD) return "contrarian";
  return "neutral";
}

function biasAxisOf(bullBias: number | null): BiasAxis | null {
  if (bullBias === null) return null;
  if (bullBias >= BULL_THRESHOLD) return "bull";
  if (bullBias <= BEAR_THRESHOLD) return "bear";
  return "balanced";
}

const LABELS: Record<MomentumAxis, Record<BiasAxis, string>> = {
  momentum: { bull: "Trend Surfer", balanced: "Momentum Hunter", bear: "Breakdown Chaser" },
  neutral: { bull: "Optimistic Drifter", balanced: "Coin Flipper", bear: "Pessimistic Drifter" },
  contrarian: { bull: "Dip Buyer", balanced: "Mean Reverter", bear: "Top Seller" },
};

export function computePersona(records: readonly AnswerRecord[]): PersonaResult {
  const n = records.length;

  const bullBias = rightRate(records);

  // Flat-trend records are not evidence either way, so they join neither group.
  const momentumScore = rateDifference(
    records.filter((r) => r.features.tailTrend === 1),
    records.filter((r) => r.features.tailTrend === -1),
  );

  const volumeSensitivity = rateDifference(
    records.filter((r) => r.features.volumeSurge),
    records.filter((r) => !r.features.volumeSurge),
  );

  // Below four records the median split is too degenerate to mean anything.
  let volatilitySensitivity: number | null = null;
  if (n >= MIN_VOLATILITY_SPLIT) {
    const cut = median(records.map((r) => r.features.realisedVol));
    volatilitySensitivity = rateDifference(
      records.filter((r) => r.features.realisedVol > cut),
      records.filter((r) => r.features.realisedVol <= cut),
    );
  }

  const decisionSpeedMs = n === 0 ? null : median(records.map((r) => r.responseMs));
  const consistency = computeConsistency(records);

  const momentumAxis = momentumAxisOf(momentumScore);
  const biasAxis = biasAxisOf(bullBias);

  return {
    metrics: {
      bullBias,
      momentumScore,
      volumeSensitivity,
      volatilitySensitivity,
      decisionSpeedMs,
      consistency,
    },
    momentumAxis,
    biasAxis,
    label: momentumAxis && biasAxis ? LABELS[momentumAxis][biasAxis] : null,
  };
}
