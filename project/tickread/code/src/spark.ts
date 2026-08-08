/**
 * The sparkle a swipe leaves behind.
 *
 * This replaced a "▲ YOU SAID UP" chip. A label that tells you what you just did is
 * the weakest possible acknowledgement: it arrives after the fact, it has to be read,
 * and it says in words what the gesture already said. A trail of stars thrown the way
 * you swiped is the same information delivered while the gesture is still happening.
 *
 * Pure, in the same sense as `chart.ts` and `demo.ts`: a spark is plain data and a
 * frame is a function of (spark, now). `app.ts` owns the canvas, the clock and the
 * pointer. Randomness is injected rather than taken from `Math.random`, so a test can
 * pin it and assert on the model instead of on luck.
 */

import type { Direction } from "./types.js";

export interface Spark {
  /** Clock reading when it was struck, in the same units as `now`. */
  bornAt: number;
  /** Origin in card space: 0..1 across, 0..1 down. Layout-independent by design. */
  x: number;
  y: number;
  /** Velocity in card-lengths per second. */
  vx: number;
  vy: number;
  /** Half-width of the star, as a fraction of the card's shorter side. */
  size: number;
  /** Radians per second. */
  spin: number;
  /** Where in its twinkle this one starts, so they do not all flash in lockstep. */
  phase: number;
  tint: string;
}

export interface SparkFrame {
  x: number;
  y: number;
  angle: number;
  size: number;
  alpha: number;
  tint: string;
}

export interface SparkOptions {
  x: number;
  y: number;
  direction: Direction;
  now: number;
  random: () => number;
  /** Multiplies the launch speed. The commit burst throws harder than the trail. */
  energy?: number;
}

/** Long enough to arc and fade, short enough to be gone before the verdict lands. */
export const SPARK_LIFE_MS = 620;

/** How many stars a committed swipe throws. */
export const BURST_COUNT = 16;

const BASE_SPEED = 0.5;
const SPREAD = 0.85;
const GRAVITY = 0.5;
/** Velocity decay. Sparks are thrown, not fired: they slow almost immediately. */
const DRAG = 3.0;
const TWINKLE_RATE = 14;

/**
 * Warm gold first in both directions, then the call's own colour.
 *
 * Not additive white: the card is white in light mode, and light-on-light is how you
 * ship an effect that only exists on your own machine. Every tint here is a mid-tone
 * that holds its own against `--card` in both themes.
 */
const PALETTE: Record<Direction, readonly string[]> = {
  up: ["#f0b429", "#ffd875", "#1a9c66", "#2bb47a"],
  down: ["#f0b429", "#ffd875", "#d1495b", "#e8798a"],
};

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}

/** One star, thrown from (x, y) into the half-plane the swipe is heading for. */
export function makeSpark(options: SparkOptions): Spark {
  const { random, direction } = options;
  const energy = options.energy ?? 1;
  // Straight up is -PI/2 in canvas coordinates; a down swipe mirrors it vertically.
  const away = direction === "up" ? 1 : -1;
  // Aimed along the swipe, fanned by up to SPREAD either side of it.
  const angle = -Math.PI / 2 + (random() - 0.5) * SPREAD;
  const speed = BASE_SPEED * energy * (0.55 + random() * 0.75);

  return {
    bornAt: options.now,
    x: options.x,
    y: options.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed * away,
    size: 0.014 + random() * 0.022,
    spin: (random() - 0.5) * 7,
    phase: random() * Math.PI * 2,
    tint: pick(PALETTE[direction], random),
  };
}

/** The handful of stars a committed swipe throws all at once. */
export function burstSparks(options: SparkOptions): Spark[] {
  const sparks: Spark[] = [];
  for (let i = 0; i < BURST_COUNT; i++) {
    sparks.push(makeSpark({ ...options, energy: (options.energy ?? 1) * 2.6 }));
  }
  return sparks;
}

/**
 * Where a spark is, and how bright, at `now`. Null once it has burned out, which is
 * the caller's cue to stop drawing it.
 *
 * The brightness envelope has a fast attack and a long decay — `sin(sqrt(u) * PI)`
 * peaks a quarter of the way in — because a spark that fades in symmetrically reads
 * as a blob growing, not as something igniting.
 */
export function sparkFrame(spark: Spark, now: number): SparkFrame | null {
  const ageMs = now - spark.bornAt;
  if (ageMs < 0 || ageMs > SPARK_LIFE_MS) return null;

  const t = ageMs / 1000;
  const u = ageMs / SPARK_LIFE_MS;
  // Distance covered by a velocity decaying at DRAG, in closed form: no per-frame
  // integration, so a frame never depends on which frames came before it.
  const travel = (1 - Math.exp(-DRAG * t)) / DRAG;
  const envelope = Math.sin(Math.sqrt(u) * Math.PI);
  const twinkle = 0.6 + 0.4 * Math.sin(spark.phase + t * TWINKLE_RATE);

  return {
    x: spark.x + spark.vx * travel,
    y: spark.y + spark.vy * travel + 0.5 * GRAVITY * t * t,
    angle: spark.phase + spark.spin * t,
    size: spark.size * (0.45 + 0.55 * envelope),
    alpha: Math.max(0, Math.min(1, envelope * twinkle)),
    tint: spark.tint,
  };
}

/** The ones still worth drawing. Keeps the caller's array from growing without end. */
export function liveSparks(sparks: readonly Spark[], now: number): Spark[] {
  return sparks.filter((s) => now - s.bornAt <= SPARK_LIFE_MS);
}
