/**
 * Cumulative history in localStorage.
 *
 * This is the app's only contact with data it did not create in this session — the
 * user may have edited it, another tab may have written it, or an old version may
 * have left an incompatible shape. Every read is therefore defensive, and this
 * boundary is what lets stats.ts and persona.ts throw freely on bad input.
 *
 * See specs/storage.md.
 */

import type { AnswerRecord, QuestionFeatures } from "./types.js";

export const HISTORY_KEY = "tickread.history.v1";
export const SEEN_KEY = "tickread.seen.v1";
export const HISTORY_CAP = 2000;
export const SEEN_CAP = 5000;

export interface HistoryStore {
  loadHistory(): AnswerRecord[];
  appendRecords(records: readonly AnswerRecord[]): void;
  loadSeen(): Set<string>;
  markSeen(ids: readonly string[]): void;
  clear(): void;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isDirection(x: unknown): boolean {
  return x === "up" || x === "down";
}

function isFeatures(x: unknown): x is QuestionFeatures {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  return (
    (f["tailTrend"] === -1 || f["tailTrend"] === 0 || f["tailTrend"] === 1) &&
    typeof f["volumeSurge"] === "boolean" &&
    isFiniteNumber(f["realisedVol"]) &&
    f["realisedVol"] >= 0
  );
}

function isRecord(x: unknown): x is AnswerRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r["questionId"] === "string" &&
    typeof r["assetClass"] === "string" &&
    typeof r["timeframe"] === "string" &&
    isFiniteNumber(r["horizon"]) &&
    isDirection(r["given"]) &&
    isDirection(r["answer"]) &&
    typeof r["correct"] === "boolean" &&
    isFiniteNumber(r["responseMs"]) &&
    r["responseMs"] >= 0 &&
    isFiniteNumber(r["ts"]) &&
    isFeatures(r["features"])
  );
}

/** Never throws. A malformed value is treated as absent, and the key is left alone. */
function readArray(storage: Storage, key: string): unknown[] {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Never throws. Losing persistence must not break the session in progress. */
function write(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded, or storage unavailable. The round still completes and the
    // report still renders from in-memory records; only history is lost.
  }
}

/** Keeps the newest `cap` entries. */
function trim<T>(items: T[], cap: number): T[] {
  return items.length <= cap ? items : items.slice(items.length - cap);
}

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/**
 * Some privacy modes throw on touching localStorage at all, so the backend is
 * probed once here and swapped for an in-memory one if it is unusable. The rest of
 * the app then has no special case to handle.
 */
function resolveBackend(candidate: Storage | undefined): Storage {
  const target = candidate ?? (globalThis as { localStorage?: Storage }).localStorage;
  if (!target) return new MemoryStorage();
  try {
    target.getItem(HISTORY_KEY);
    return target;
  } catch {
    return new MemoryStorage();
  }
}

export function createHistoryStore(storage?: Storage): HistoryStore {
  const backend = resolveBackend(storage);

  function loadHistory(): AnswerRecord[] {
    return readArray(backend, HISTORY_KEY).filter(isRecord);
  }

  function loadSeenList(): string[] {
    return readArray(backend, SEEN_KEY).filter((x): x is string => typeof x === "string");
  }

  return {
    loadHistory,

    appendRecords(records) {
      write(backend, HISTORY_KEY, trim([...loadHistory(), ...records], HISTORY_CAP));
    },

    loadSeen() {
      return new Set(loadSeenList());
    },

    markSeen(ids) {
      const existing = loadSeenList();
      const known = new Set(existing);
      for (const id of ids) {
        if (!known.has(id)) {
          known.add(id);
          existing.push(id);
        }
      }
      write(backend, SEEN_KEY, trim(existing, SEEN_CAP));
    },

    clear() {
      try {
        backend.removeItem(HISTORY_KEY);
        backend.removeItem(SEEN_KEY);
      } catch {
        // Same rationale as write().
      }
    },
  };
}
