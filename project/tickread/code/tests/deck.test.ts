import { test, assert, assertEqual } from "./harness.js";
import {
  DEFAULT_DECK_SIZE,
  drawDeck,
  isAskable,
  loadManifest,
  loadShard,
  buildRound,
} from "../src/deck.js";
import type { Bar, Direction, Horizon, Manifest, Question, Timeframe } from "../src/types.js";

/** Deterministic PRNG so a failing draw can be reproduced from its seed. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function flatSetup(): Bar[] {
  return Array.from({ length: 60 }, () => ({ o: 100, h: 100, l: 100, c: 100, v: 1000 }));
}

let nextId = 0;
function question(
  timeframe: Timeframe,
  horizon: Horizon,
  answer: Direction = "up",
): Question {
  return {
    id: `q${nextId++}`,
    assetClass: "equity",
    timeframe,
    horizon,
    setup: flatSetup(),
    future: Array.from({ length: horizon }, () => ({ o: 100, h: 101, l: 99, c: 101, v: 1000 })),
    answer,
  };
}

/** A pool covering every timeframe and horizon, balanced up/down. */
function fullPool(perStratum: number): Question[] {
  const timeframes: Timeframe[] = ["1m", "1h", "1d", "1mo"];
  const horizons: Horizon[] = [1, 5, 20];
  const out: Question[] = [];
  for (const tf of timeframes) {
    for (const h of horizons) {
      for (let i = 0; i < perStratum; i++) {
        out.push(question(tf, h, i % 2 === 0 ? "up" : "down"));
      }
    }
  }
  return out;
}

// --- the strata the game refuses to ask ---

test("drawDeck never deals a one-bar question on the minute chart", () => {
  // The next one-minute bar is bid-ask noise. Asking it produces a stratum nobody can
  // beat, which drags the all-time numbers toward 50% while teaching nothing.
  for (let seed = 1; seed <= 25; seed++) {
    const drawn = drawDeck(fullPool(20), { random: seeded(seed), size: 12 });
    const offending = drawn.filter((q) => q.timeframe === "1m" && q.horizon === 1);
    assertEqual(offending.length, 0, `seed ${seed} dealt a 1m one-bar question`);
  }
});

test("drawDeck still fills a round from the strata that remain", () => {
  const drawn = drawDeck(fullPool(20), { random: seeded(3) });
  assertEqual(drawn.length, DEFAULT_DECK_SIZE, "excluding a stratum must not short the round");
});

test("drawDeck returns nothing when every question is one the game will not ask", () => {
  const pool = Array.from({ length: 8 }, () => question("1m", 1));
  assertEqual(drawDeck(pool, { random: seeded(1) }), []);
});

test("isAskable names the excluded pair and nothing else", () => {
  assert(!isAskable("1m", 1), "1m one-bar must be off the map");
  for (const [timeframe, horizon] of [
    ["1m", 5], ["1m", 20], ["1h", 1], ["1d", 1], ["1mo", 1],
  ] as [Timeframe, Horizon][]) {
    assert(isAskable(timeframe, horizon), `${timeframe}|${horizon} should still be asked`);
  }
});

test("drawDeck defaults to ten questions", () => {
  assertEqual(DEFAULT_DECK_SIZE, 10);
  assertEqual(drawDeck(fullPool(20), { random: seeded(1) }).length, 10);
});

test("drawDeck returns exactly the requested size", () => {
  const deck = drawDeck(fullPool(20), { size: 20, random: seeded(1) });
  assertEqual(deck.length, 20);
});

test("drawDeck never repeats a question within a round", () => {
  const deck = drawDeck(fullPool(20), { size: 20, random: seeded(2) });
  assertEqual(new Set(deck.map((q) => q.id)).size, deck.length);
});

test("drawDeck covers every stratum it is willing to ask", () => {
  const deck = drawDeck(fullPool(20), { size: 12, random: seeded(3) });
  const strata = new Set(deck.map((q) => `${q.timeframe}|${q.horizon}`));
  // Eleven, not twelve: the minute chart's one-bar square is not asked.
  assertEqual(strata.size, 11, "every askable timeframe/horizon stratum appears");
  assert(!strata.has("1m|1"), "the unasked stratum must not appear");
});

test("drawDeck does not starve a thin stratum", () => {
  // 500 daily questions against 5 monthly ones. Proportional sampling would
  // almost never surface a monthly chart.
  const pool: Question[] = [];
  for (let i = 0; i < 500; i++) pool.push(question("1d", 5, i % 2 === 0 ? "up" : "down"));
  for (let i = 0; i < 5; i++) pool.push(question("1mo", 5, i % 2 === 0 ? "up" : "down"));

  for (let seed = 1; seed <= 10; seed++) {
    const deck = drawDeck(pool, { size: 20, random: seeded(seed) });
    const monthly = deck.filter((q) => q.timeframe === "1mo").length;
    assert(monthly > 0, `seed ${seed} produced no monthly question`);
  }
});

test("drawDeck prefers questions the user has not seen", () => {
  const pool = fullPool(20); // 240 questions: 12 strata of 20
  // Mark 15 of every stratum's 20 as seen, leaving 5 fresh in each. Spreading them
  // matters: the preference is defined *within* a stratum, so concentrating all the
  // unseen questions into a few strata would legitimately still return repeats.
  const seen = new Set(pool.filter((_, i) => i % 20 < 15).map((q) => q.id));
  const deck = drawDeck(pool, { size: 20, seen, random: seeded(4) });
  assertEqual(deck.filter((q) => seen.has(q.id)).length, 0, "5 fresh per stratum");
});

test("drawDeck still fills a round when everything has been seen", () => {
  const pool = fullPool(5);
  const seen = new Set(pool.map((q) => q.id));
  const deck = drawDeck(pool, { size: 20, seen, random: seeded(5) });
  assertEqual(deck.length, 20, "seen is a sort key, not a filter");
});

test("drawDeck does not repair the sampled answer mix", () => {
  // The bank is balanced per bucket offline, so a round is allowed to come out
  // lopsided. Reaching back into the pool to swap answers in would bias which
  // charts a round can contain, which is a worse problem than sampling noise.
  const pool = [
    ...Array.from({ length: 10 }, () => question("1d", 5, "up")),
    ...Array.from({ length: 10 }, () => question("1d", 5, "down")),
  ];
  // A random that always returns ~1 makes the shuffle the identity, so the ten
  // "up" questions at the front of the pool are exactly what gets drawn.
  const deck = drawDeck(pool, { size: 10, random: () => 0.999999 });
  assertEqual(deck.length, 10);
  assertEqual(deck.every((q) => q.answer === "up"), true, "the mix must be left alone");
});

test("drawDeck returns the whole pool when it is smaller than the round", () => {
  const pool = fullPool(1); // 12 questions, one of which the game will not ask
  const deck = drawDeck(pool, { size: 20, random: seeded(7) });
  assertEqual(deck.length, 11);
});

test("drawDeck returns nothing for an empty pool or a non-positive size", () => {
  assertEqual(drawDeck([], { size: 20, random: seeded(8) }), []);
  assertEqual(drawDeck(fullPool(5), { size: 0, random: seeded(8) }), []);
  assertEqual(drawDeck(fullPool(5), { size: -3, random: seeded(8) }), []);
});

test("drawDeck is deterministic for a given seed", () => {
  const pool = fullPool(20);
  const a = drawDeck(pool, { size: 20, random: seeded(99) }).map((q) => q.id);
  const b = drawDeck(pool, { size: 20, random: seeded(99) }).map((q) => q.id);
  assertEqual(a, b);
});

// --- network-facing functions, against a stubbed fetch ---

const manifest: Manifest = {
  version: 1,
  generatedAt: "2026-08-01T00:00:00Z",
  setupLength: 60,
  shards: [
    { timeframe: "1d", file: "questions-1d.json", count: 2, assetClasses: ["equity"], horizons: [5] },
    { timeframe: "1mo", file: "questions-1mo.json", count: 2, assetClasses: ["equity"], horizons: [5] },
  ],
};

/**
 * Stubs fetch, and silences console.warn for the duration — several of these tests
 * exercise the shard-failure path on purpose, and their warnings would otherwise
 * bury a real failure in the run output.
 */
function stubFetch(routes: Record<string, { status?: number; body?: string }>): () => void {
  const original = globalThis.fetch;
  const originalWarn = console.warn;
  console.warn = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes[url];
    if (!hit) return { ok: false, status: 404, url } as Response;
    const status = hit.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      url,
      json: async () => JSON.parse(hit.body ?? ""),
    } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
    console.warn = originalWarn;
  };
}

test("loadManifest parses a valid manifest", async () => {
  const restore = stubFetch({ "./data/manifest.json": { body: JSON.stringify(manifest) } });
  try {
    assertEqual((await loadManifest("./data")).shards.length, 2);
  } finally {
    restore();
  }
});

test("loadManifest reports the url when the fetch fails", async () => {
  const restore = stubFetch({});
  try {
    let message = "";
    try {
      await loadManifest("./data");
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    assert(message.includes("manifest.json"), `message should name the file: ${message}`);
  } finally {
    restore();
  }
});

test("loadManifest rejects an unknown manifest version", async () => {
  const restore = stubFetch({
    "./data/manifest.json": { body: JSON.stringify({ ...manifest, version: 2 }) },
  });
  try {
    let threw = false;
    try {
      await loadManifest("./data");
    } catch {
      threw = true;
    }
    assertEqual(threw, true);
  } finally {
    restore();
  }
});

test("loadShard returns the shard's questions", async () => {
  const body = JSON.stringify([question("1d", 5), question("1d", 5)]);
  const restore = stubFetch({ "./data/questions-1d.json": { body } });
  try {
    assertEqual((await loadShard("./data", manifest.shards[0]!)).length, 2);
  } finally {
    restore();
  }
});

test("buildRound survives one shard failing to load", async () => {
  const body = JSON.stringify(Array.from({ length: 30 }, () => question("1d", 5)));
  const restore = stubFetch({
    "./data/manifest.json": { body: JSON.stringify(manifest) },
    "./data/questions-1d.json": { body },
    // questions-1mo.json deliberately absent
  });
  try {
    const deck = await buildRound("./data", { size: 20, random: seeded(11) });
    assertEqual(deck.length, 20);
    assertEqual(deck.every((q) => q.timeframe === "1d"), true);
  } finally {
    restore();
  }
});

test("buildRound throws when every shard fails to load", async () => {
  const restore = stubFetch({ "./data/manifest.json": { body: JSON.stringify(manifest) } });
  try {
    let threw = false;
    try {
      await buildRound("./data", { size: 20, random: seeded(12) });
    } catch {
      threw = true;
    }
    assertEqual(threw, true);
  } finally {
    restore();
  }
});
