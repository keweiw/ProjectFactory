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
