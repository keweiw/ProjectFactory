/**
 * The landing page's self-playing chart.
 *
 * The old landing page explained the game in three paragraphs. This plays it
 * instead: a real chart settles, a hand appears, the card lifts, and the true
 * future bars draw themselves in — the whole loop the player is about to do.
 *
 * A pure function of elapsed time, no DOM. `app.ts` owns the requestAnimationFrame
 * loop and does the painting, which keeps it the only module touching the document.
 */

import type { Direction } from "./types.js";

export type DemoPhase = "settle" | "poise" | "swipe" | "reveal" | "rest";

export interface DemoFrame {
  phase: DemoPhase;
  /**
   * Bars of the future to draw. 0 until the swipe has committed, and fractional
   * once it has — see `ChartOptions.revealCount`. Whole bars alone gave a one-bar
   * demo question a single jump instead of a reveal.
   */
  revealCount: number;
  /**
   * Vertical offset of the ghost card as a fraction of its own height: -1 is one
   * card-height up, 0 is at rest. Normalised rather than pixels so this function
   * stays independent of layout — `app.ts` scales it when painting.
   */
  cardOffset: number;
  /** The call the ghost hand is making, or null before it commits. */
  direction: Direction | null;
  /** 0–1, for fading the hand marker in and out. */
  handOpacity: number;
}

const SETTLE_MS = 900;
const POISE_MS = 600;
const SWIPE_MS = 400;
const REVEAL_MS = 800;
const REST_MS = 900;

const POISE_AT = SETTLE_MS;
const SWIPE_AT = POISE_AT + POISE_MS;
const REVEAL_AT = SWIPE_AT + SWIPE_MS;
const REST_AT = REVEAL_AT + REVEAL_MS;

/** One full pass: settle, poise, swipe, reveal, rest. */
export const DEMO_CYCLE_MS = REST_AT + REST_MS;

/** How far the card lifts at the top of the swipe, as a fraction of its height. */
const LIFT = 0.22;

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Frame state at a point in the cycle. Elapsed time beyond one cycle wraps, so the
 * caller can hand it a monotonically increasing clock and never do the arithmetic.
 */
export function demoFrame(elapsedMs: number, horizonBars: number): DemoFrame {
  const t = ((elapsedMs % DEMO_CYCLE_MS) + DEMO_CYCLE_MS) % DEMO_CYCLE_MS;
  const revealed = Math.max(0, horizonBars);

  if (t < POISE_AT) {
    return { phase: "settle", revealCount: 0, cardOffset: 0, direction: null, handOpacity: 0 };
  }

  if (t < SWIPE_AT) {
    return {
      phase: "poise",
      revealCount: 0,
      cardOffset: 0,
      direction: null,
      handOpacity: easeOut((t - POISE_AT) / POISE_MS),
    };
  }

  if (t < REVEAL_AT) {
    // The card lifts and settles back within the swipe, so the chart is in place
    // again by the time the bars start drawing into it.
    const progress = (t - SWIPE_AT) / SWIPE_MS;
    const arc = Math.sin(progress * Math.PI);
    return {
      phase: "swipe",
      revealCount: 0,
      cardOffset: -LIFT * arc,
      direction: "up",
      handOpacity: 1 - progress,
    };
  }

  if (t < REST_AT) {
    const progress = (t - REVEAL_AT) / REVEAL_MS;
    return {
      phase: "reveal",
      revealCount: Math.min(revealed, easeOut(progress) * revealed),
      cardOffset: 0,
      direction: "up",
      handOpacity: 0,
    };
  }

  return {
    phase: "rest",
    revealCount: revealed,
    cardOffset: 0,
    direction: "up",
    handOpacity: 0,
  };
}
