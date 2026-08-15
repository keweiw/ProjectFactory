/**
 * Every interface shared between modules is declared here, even when another
 * module is the authority on its meaning. Declaring them where they are
 * conceptually owned would make `session` and `persona` import each other.
 *
 * No logic lives in this file.
 */

// --- Core question bank types. Authority: specs/data-pipeline.md ---

export type AssetClass = "equity" | "etf_index" | "future" | "crypto";
export type Timeframe = "1m" | "1h" | "1d" | "1mo";
export type Horizon = 1 | 5 | 20;
export type Direction = "up" | "down";

/** A shipped bar. Deliberately carries no timestamp — see the anonymisation rule. */
export interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Question {
  id: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  horizon: Horizon;
  /** Revealed only after the player answers. Epoch timestamps are UTC seconds. */
  symbol?: string;
  startTime?: number;
  endTime?: number;
  setup: Bar[];
  future: Bar[];
  answer: Direction;
}

export interface ShardInfo {
  timeframe: Timeframe;
  file: string;
  count: number;
  assetClasses: AssetClass[];
  horizons: Horizon[];
}

export interface Manifest {
  version: 1;
  generatedAt: string;
  setupLength: number;
  shards: ShardInfo[];
}

export const SETUP_LENGTH = 60;

export const ASSET_CLASS_ORDER: readonly AssetClass[] = [
  "equity",
  "etf_index",
  "future",
  "crypto",
];
export const TIMEFRAME_ORDER: readonly Timeframe[] = ["1m", "1h", "1d", "1mo"];
export const HORIZON_ORDER: readonly Horizon[] = [1, 5, 20];

/**
 * Timeframe × horizon pairs the game refuses to ask.
 *
 * The next one-minute bar is not a hard question, it is an unanswerable one: at that
 * scale the next print is bid-ask bounce and order flow, with no move large enough
 * for anything visible in the previous sixty bars to bear on. Every other cell asks
 * something a reader can in principle get better at; this one asks them to call a
 * coin, then reports — correctly — that they cannot beat a coin flip.
 *
 * Shipped questions for it stay in the bank. This is a rule about what to ask, so it
 * lives with the other shared constants rather than in the offline data build, and
 * history recorded before the rule existed still reports honestly.
 */
export const UNASKED_STRATA: ReadonlySet<string> = new Set(["1m|1"]);

/**
 * How a timeframe and an asset class are written for a reader. Constant lookup
 * tables, in the same category as the ORDER arrays above and declared here for the
 * same reason: both `app` (the card header) and `report-view` (the bucket labels)
 * need them, and giving either one ownership would make the two import each other.
 */
export const TIMEFRAME_WORDS: Record<Timeframe, string> = {
  "1m": "1-minute",
  "1h": "Hourly",
  "1d": "Daily",
  "1mo": "Monthly",
};

export const ASSET_WORDS: Record<AssetClass, string> = {
  equity: "US equity",
  etf_index: "ETF / index",
  future: "Futures",
  crypto: "Crypto",
};

// --- Behavioural features. Authority: specs/persona.md ---

export interface QuestionFeatures {
  tailTrend: -1 | 0 | 1;
  volumeSurge: boolean;
  realisedVol: number;
}

export interface PersonaMetrics {
  bullBias: number | null;
  momentumScore: number | null;
  volumeSensitivity: number | null;
  volatilitySensitivity: number | null;
  decisionSpeedMs: number | null;
  consistency: number | null;
}

export type MomentumAxis = "momentum" | "neutral" | "contrarian";
export type BiasAxis = "bull" | "balanced" | "bear";

export interface PersonaResult {
  metrics: PersonaMetrics;
  momentumAxis: MomentumAxis | null;
  biasAxis: BiasAxis | null;
  label: string | null;
}

// --- Round state. Authority: specs/session.md ---

export interface AnswerRecord {
  questionId: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  horizon: Horizon;
  given: Direction;
  answer: Direction;
  correct: boolean;
  responseMs: number;
  features: QuestionFeatures;
  ts: number;
}

export interface SessionState {
  readonly questions: readonly Question[];
  readonly index: number;
  readonly records: readonly AnswerRecord[];
}

// --- Report statistics. Authority: specs/stats.md ---

export interface Interval {
  low: number;
  high: number;
}

export type Significance = "strength" | "weakness" | "inconclusive";

export interface BucketStat {
  key: string;
  correct: number;
  total: number;
  accuracy: number;
  interval: Interval;
  significance: Significance;
}

export interface Scorecard {
  overall: BucketStat;
  byAssetClass: BucketStat[];
  byTimeframe: BucketStat[];
  byHorizon: BucketStat[];
}
