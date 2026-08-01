/**
 * Assembles one round.
 *
 * Stratification and balance repair are what make the report interpretable. A
 * uniform random draw would leave report buckets empty and could hand the user a
 * round that is 15 up — against which swiping right on everything scores 75% and
 * the scorecard lies. See specs/deck.md.
 *
 * The network functions are thin; `drawDeck` is pure and holds all the logic.
 */

import type { Direction, Manifest, Question, ShardInfo } from "./types.js";

export interface DeckOptions {
  size?: number;
  seen?: ReadonlySet<string>;
  random?: () => number;
}

export const DEFAULT_DECK_SIZE = 20;

function stratumOf(q: Question): string {
  return `${q.timeframe}|${q.horizon}`;
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

/**
 * Best effort. If no swap candidate exists the imbalance is accepted — a slightly
 * lopsided round beats a failed one, and the bank is already balanced per bucket,
 * so this only corrects sampling noise. The loop is bounded so a swap that fails
 * to improve the count cannot spin.
 */
function repairBalance(
  selected: Question[],
  spare: Question[],
  seen: ReadonlySet<string>,
): void {
  for (let guard = selected.length; guard > 0; guard--) {
    let up = 0;
    for (const q of selected) if (q.answer === "up") up++;
    const down = selected.length - up;
    if (Math.abs(up - down) <= 1) return;

    const over: Direction = up > down ? "up" : "down";
    const wanted: Direction = over === "up" ? "down" : "up";

    const outIndex = selected.findIndex((q) => q.answer === over);
    if (outIndex === -1) return;
    const stratum = stratumOf(selected[outIndex]!);

    // Same stratum keeps coverage intact; unseen keeps the round fresh.
    const preferences: Array<(q: Question) => boolean> = [
      (q) => q.answer === wanted && stratumOf(q) === stratum && !seen.has(q.id),
      (q) => q.answer === wanted && stratumOf(q) === stratum,
      (q) => q.answer === wanted && !seen.has(q.id),
      (q) => q.answer === wanted,
    ];

    let inIndex = -1;
    for (const matches of preferences) {
      inIndex = spare.findIndex(matches);
      if (inIndex !== -1) break;
    }
    if (inIndex === -1) return;

    const incoming = spare.splice(inIndex, 1)[0]!;
    const outgoing = selected.splice(outIndex, 1, incoming)[0]!;
    spare.push(outgoing);
  }
}

export function drawDeck(pool: readonly Question[], options: DeckOptions = {}): Question[] {
  const size = options.size ?? DEFAULT_DECK_SIZE;
  const seen = options.seen ?? new Set<string>();
  const random = options.random ?? Math.random;

  if (size <= 0 || pool.length === 0) return [];

  const strata = new Map<string, Question[]>();
  for (const q of pool) {
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

  const chosen = new Set(selected.map((q) => q.id));
  repairBalance(selected, pool.filter((q) => !chosen.has(q.id)), seen);

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
