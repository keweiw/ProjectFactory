/**
 * Assembles one round.
 *
 * Stratification is what makes the report interpretable: a uniform random draw
 * would leave report buckets empty. The up/down mix, by contrast, is left exactly
 * as sampled — the bank is already balanced per bucket offline, so swapping answers
 * into a live round would bias which charts it can contain to fix nothing worse
 * than sampling noise. See specs/deck.md.
 *
 * The network functions are thin; `drawDeck` is pure and holds all the logic.
 */

import { UNASKED_STRATA } from "./types.js";
import type { Horizon, Manifest, Question, ShardInfo, Timeframe } from "./types.js";

export interface DeckOptions {
  size?: number;
  seen?: ReadonlySet<string>;
  random?: () => number;
}

/**
 * Ten, not twenty. A round has to be finishable in a sitting for the immediate
 * feedback loop to be worth anything; the statistics come from all-time history,
 * which accumulates across rounds regardless of how long each one is.
 */
export const DEFAULT_DECK_SIZE = 10;

/** The bucket a question belongs to, and the key `UNASKED_STRATA` is written in. */
export function stratumKey(timeframe: Timeframe, horizon: Horizon): string {
  return `${timeframe}|${horizon}`;
}

/**
 * Whether the game asks this pair at all. Exported because the report has to leave a
 * hole in the skill map for a square it will never let anyone open.
 */
export function isAskable(timeframe: Timeframe, horizon: Horizon): boolean {
  return !UNASKED_STRATA.has(stratumKey(timeframe, horizon));
}

function stratumOf(q: Question): string {
  return stratumKey(q.timeframe, q.horizon);
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return out;
}

export function drawDeck(pool: readonly Question[], options: DeckOptions = {}): Question[] {
  const size = options.size ?? DEFAULT_DECK_SIZE;
  const seen = options.seen ?? new Set<string>();
  const random = options.random ?? Math.random;

  if (size <= 0 || pool.length === 0) return [];

  const strata = new Map<string, Question[]>();
  for (const q of pool) {
    // Filtered here rather than out of the bank: the rule is about what gets asked,
    // and a shard is free to carry questions a later rule stops asking.
    if (!isAskable(q.timeframe, q.horizon)) continue;
    const key = stratumOf(q);
    const existing = strata.get(key);
    if (existing) existing.push(q);
    else strata.set(key, [q]);
  }

  // Shuffle inside each stratum, then float unseen questions to the front so the
  // user exhausts fresh material before repeating any.
  const ordered = [...strata.values()].map((list) => {
    const mixed = shuffle(list, random);
    return [...mixed.filter((q) => !seen.has(q.id)), ...mixed.filter((q) => seen.has(q.id))];
  });

  // Round-robin rather than proportional allocation, so a bank with far more daily
  // than monthly questions still shows monthly charts.
  const rotation = shuffle(ordered, random);
  const cursors = new Array<number>(rotation.length).fill(0);
  const selected: Question[] = [];
  let progressed = true;
  while (selected.length < size && progressed) {
    progressed = false;
    for (let i = 0; i < rotation.length && selected.length < size; i++) {
      const list = rotation[i]!;
      const cursor = cursors[i]!;
      if (cursor < list.length) {
        selected.push(list[cursor]!);
        cursors[i] = cursor + 1;
        progressed = true;
      }
    }
  }

  // Final shuffle so nothing can be inferred from the order strata appear in.
  return shuffle(selected, random);
}

function join(baseUrl: string, file: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${file}`;
}

export async function loadManifest(baseUrl: string): Promise<Manifest> {
  const url = join(baseUrl, "manifest.json");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as Manifest;
  if (parsed?.version !== 1 || !Array.isArray(parsed.shards) || parsed.shards.length === 0) {
    throw new Error(`${url} is not a usable manifest`);
  }
  return parsed;
}

export async function loadShard(baseUrl: string, shard: ShardInfo): Promise<Question[]> {
  const url = join(baseUrl, shard.file);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as Question[];
  if (!Array.isArray(parsed)) throw new Error(`${url} is not a question array`);
  return parsed;
}

export async function buildRound(
  baseUrl: string,
  options: DeckOptions = {},
): Promise<Question[]> {
  const manifest = await loadManifest(baseUrl);

  const results = await Promise.allSettled(
    manifest.shards.map((shard) => loadShard(baseUrl, shard)),
  );

  const pool: Question[] = [];
  for (const result of results) {
    // One bad shard degrades coverage; it should not cost the user their round.
    if (result.status === "fulfilled") pool.push(...result.value);
    else console.warn("tickread: shard failed to load", result.reason);
  }
  if (pool.length === 0) {
    throw new Error("No question shards could be loaded");
  }

  return drawDeck(pool, options);
}
