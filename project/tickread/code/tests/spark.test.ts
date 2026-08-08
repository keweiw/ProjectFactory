import { test, assert, assertEqual } from "./harness.js";
import {
  burstSparks,
  liveSparks,
  makeSpark,
  sparkFrame,
  SPARK_LIFE_MS,
} from "../src/spark.js";
import type { Spark } from "../src/spark.js";

/** A seeded generator, so every assertion below is about the model, not about luck. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function burst(direction: "up" | "down", seed = 1): Spark[] {
  return burstSparks({ x: 0.5, y: 0.5, direction, now: 0, random: seeded(seed) });
}

test("a burst throws its sparks the way the swipe went", () => {
  // Canvas y grows downward, so an upward swipe means a negative vy.
  const up = burst("up");
  const down = burst("down");
  const meanVy = (sparks: Spark[]): number =>
    sparks.reduce((sum, s) => sum + s.vy, 0) / sparks.length;
  assert(meanVy(up) < 0, `an up swipe threw its sparks downward: ${meanVy(up)}`);
  assert(meanVy(down) > 0, `a down swipe threw its sparks upward: ${meanVy(down)}`);
});

test("a burst spreads rather than firing one straight line", () => {
  const sparks = burst("up");
  const spread = new Set(sparks.map((s) => s.vx.toFixed(3)));
  assert(spread.size > sparks.length / 2, `only ${spread.size} distinct headings`);
});

test("a burst is a burst, not a single spark", () => {
  assert(burst("up").length >= 10, "a commit should throw a handful of stars");
});

test("sparks are deterministic given the same source of randomness", () => {
  assertEqual(burst("up", 7), burst("up", 7));
});

test("a spark fades in and out rather than snapping on at full brightness", () => {
  const spark = makeSpark({ x: 0.5, y: 0.5, direction: "up", now: 0, random: seeded(3) });
  const alphaAt = (t: number): number => {
    const frame = sparkFrame(spark, t);
    assert(frame !== null, `no frame at ${t}ms`);
    return frame!.alpha;
  };
  const born = alphaAt(1);
  const peak = alphaAt(SPARK_LIFE_MS * 0.25);
  const dying = alphaAt(SPARK_LIFE_MS * 0.95);
  assert(born < peak, `a spark should ignite, not appear: ${born} then ${peak}`);
  assert(dying < peak, `a spark should fade out: ${peak} then ${dying}`);
  assert(born > 0, "a spark that starts at nothing is a wasted frame");
});

test("a spark keeps its alpha inside the drawable range", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const spark = makeSpark({ x: 0.5, y: 0.5, direction: "down", now: 0, random: seeded(seed) });
    for (let t = 0; t <= SPARK_LIFE_MS; t += 9) {
      const frame = sparkFrame(spark, t)!;
      assert(frame.alpha >= 0 && frame.alpha <= 1, `alpha ${frame.alpha} at ${t}ms`);
    }
  }
});

test("a spark travels away from where it was struck", () => {
  const spark = makeSpark({ x: 0.5, y: 0.5, direction: "up", now: 0, random: seeded(11) });
  const start = sparkFrame(spark, 0)!;
  const later = sparkFrame(spark, SPARK_LIFE_MS * 0.6)!;
  assert(later.y < start.y, `an up spark did not rise: ${start.y} then ${later.y}`);
});

test("a spark is gone once its life is over", () => {
  const spark = makeSpark({ x: 0.5, y: 0.5, direction: "up", now: 0, random: seeded(5) });
  assert(sparkFrame(spark, SPARK_LIFE_MS + 1) === null, "a dead spark still rendered");
});

test("a spark never produces a coordinate the canvas cannot use", () => {
  for (const direction of ["up", "down"] as const) {
    for (const spark of burstSparks({
      x: 0.2, y: 0.8, direction, now: 0, random: seeded(42),
    })) {
      for (let t = 0; t <= SPARK_LIFE_MS; t += 11) {
        const frame = sparkFrame(spark, t)!;
        for (const value of [frame.x, frame.y, frame.size, frame.angle, frame.alpha]) {
          assert(Number.isFinite(value), `non-finite ${value} at ${t}ms`);
        }
      }
    }
  }
});

test("liveSparks keeps the living and drops the dead", () => {
  const old = burstSparks({ x: 0.5, y: 0.5, direction: "up", now: 0, random: seeded(2) });
  const fresh = burstSparks({
    x: 0.5, y: 0.5, direction: "up", now: SPARK_LIFE_MS, random: seeded(9),
  });
  const kept = liveSparks([...old, ...fresh], SPARK_LIFE_MS + 10);
  assertEqual(kept.length, fresh.length, "exactly the fresh burst should survive");
});

test("liveSparks never grows the list it was given", () => {
  const sparks = burst("up");
  assert(liveSparks(sparks, 0).length <= sparks.length, "pruning must not add sparks");
  assertEqual(liveSparks([], 100), []);
});

test("a spark is tinted, and up and down do not look the same", () => {
  const up = new Set(burst("up").map((s) => s.tint));
  const down = new Set(burst("down").map((s) => s.tint));
  assert(up.size > 1, "a single flat colour is not a sparkle");
  assert([...down].some((tint) => !up.has(tint)), "the two directions share every colour");
});
