import { test, assert, assertEqual } from "./harness.js";
import {
  createHistoryStore,
  HISTORY_KEY,
  SEEN_KEY,
  HISTORY_CAP,
  SEEN_CAP,
} from "../src/storage.js";
import type { AnswerRecord } from "../src/types.js";

/** In-memory Storage. `failOnWrite` simulates a full or unavailable quota. */
class FakeStorage implements Storage {
  private map = new Map<string, string>();
  constructor(public failOnWrite = false) {}

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
    if (this.failOnWrite) throw new DOMException("quota", "QuotaExceededError");
    this.map.set(key, value);
  }
}

function record(id: string): AnswerRecord {
  return {
    questionId: id,
    assetClass: "equity",
    timeframe: "1d",
    horizon: 5,
    given: "up",
    answer: "up",
    correct: true,
    responseMs: 500,
    features: { tailTrend: 1, volumeSurge: false, realisedVol: 0.02 },
    ts: 1,
  };
}

test("history round trips through storage", () => {
  const fake = new FakeStorage();
  const store = createHistoryStore(fake);
  store.appendRecords([record("a"), record("b")]);
  assertEqual(
    store.loadHistory().map((r) => r.questionId),
    ["a", "b"],
  );
});

test("appendRecords accumulates rather than replacing", () => {
  const store = createHistoryStore(new FakeStorage());
  store.appendRecords([record("a")]);
  store.appendRecords([record("b")]);
  assertEqual(
    store.loadHistory().map((r) => r.questionId),
    ["a", "b"],
  );
});

test("history drops the oldest records once it exceeds the cap", () => {
  const store = createHistoryStore(new FakeStorage());
  const many = Array.from({ length: HISTORY_CAP + 10 }, (_, i) => record(`q${i}`));
  store.appendRecords(many);
  const kept = store.loadHistory();
  assertEqual(kept.length, HISTORY_CAP);
  assertEqual(kept[0]!.questionId, "q10", "oldest ten were dropped");
  assertEqual(kept[kept.length - 1]!.questionId, `q${HISTORY_CAP + 9}`);
});

test("an absent history key reads as empty and writes nothing", () => {
  const fake = new FakeStorage();
  const store = createHistoryStore(fake);
  assertEqual(store.loadHistory(), []);
  assertEqual(fake.getItem(HISTORY_KEY), null);
});

test("malformed history reads as empty without destroying the key", () => {
  for (const junk of ["{", "null", "42", '"a string"', "[1,2,3]"]) {
    const fake = new FakeStorage();
    fake.setItem(HISTORY_KEY, junk);
    const store = createHistoryStore(fake);
    assertEqual(store.loadHistory(), [], `input ${junk}`);
    assertEqual(fake.getItem(HISTORY_KEY), junk, `key preserved for ${junk}`);
  }
});

test("individual invalid records are dropped and the valid ones kept", () => {
  const good = record("good");
  const invalid: unknown[] = [
    { ...record("x"), questionId: 5 },
    { ...record("x"), given: "sideways" },
    { ...record("x"), answer: null },
    { ...record("x"), correct: "yes" },
    { ...record("x"), responseMs: -1 },
    { ...record("x"), responseMs: Number.NaN },
    { ...record("x"), ts: "now" },
    { ...record("x"), features: null },
    { ...record("x"), features: { ...record("x").features, tailTrend: 2 } },
    { ...record("x"), features: { ...record("x").features, volumeSurge: 1 } },
    { ...record("x"), features: { ...record("x").features, realisedVol: -0.1 } },
    null,
    "nope",
  ];
  const fake = new FakeStorage();
  fake.setItem(HISTORY_KEY, JSON.stringify([...invalid, good]));
  const kept = createHistoryStore(fake).loadHistory();
  assertEqual(kept.length, 1, "only the valid record survives");
  assertEqual(kept[0]!.questionId, "good");
});

test("a failing write does not throw and leaves earlier history readable", () => {
  const fake = new FakeStorage();
  const store = createHistoryStore(fake);
  store.appendRecords([record("a")]);
  fake.failOnWrite = true;
  store.appendRecords([record("b")]);
  assertEqual(
    store.loadHistory().map((r) => r.questionId),
    ["a"],
  );
});

test("a storage backend that throws on access falls back to working in memory", () => {
  const exploding = new Proxy({} as Storage, {
    get() {
      throw new Error("access denied");
    },
  });
  const store = createHistoryStore(exploding);
  store.appendRecords([record("a")]);
  assertEqual(store.loadHistory().length, 1, "in-memory fallback still works");
});

test("seen ids round trip and do not duplicate", () => {
  const store = createHistoryStore(new FakeStorage());
  store.markSeen(["a", "b"]);
  store.markSeen(["b", "c"]);
  assertEqual([...store.loadSeen()].sort(), ["a", "b", "c"]);
});

test("seen ids drop the oldest once they exceed the cap", () => {
  const fake = new FakeStorage();
  const store = createHistoryStore(fake);
  store.markSeen(Array.from({ length: SEEN_CAP + 5 }, (_, i) => `q${i}`));
  const seen = store.loadSeen();
  assertEqual(seen.size, SEEN_CAP);
  assert(!seen.has("q0"), "oldest dropped");
  assert(seen.has(`q${SEEN_CAP + 4}`), "newest kept");
});

test("malformed seen data reads as an empty set", () => {
  const fake = new FakeStorage();
  fake.setItem(SEEN_KEY, "{oops");
  assertEqual(createHistoryStore(fake).loadSeen().size, 0);
});

test("clear removes both keys and leaves unrelated keys alone", () => {
  const fake = new FakeStorage();
  fake.setItem("unrelated", "keep me");
  const store = createHistoryStore(fake);
  store.appendRecords([record("a")]);
  store.markSeen(["a"]);
  store.clear();
  assertEqual(fake.getItem(HISTORY_KEY), null);
  assertEqual(fake.getItem(SEEN_KEY), null);
  assertEqual(fake.getItem("unrelated"), "keep me");
});
