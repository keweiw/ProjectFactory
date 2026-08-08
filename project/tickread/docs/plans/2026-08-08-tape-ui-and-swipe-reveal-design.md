# The Tape, the Visible Reveal, and a Landing Page That Plays Itself

**Date:** 2026-08-08
**Status:** Approved

## Purpose

Make tickread read as a game rather than a form, and make its best existing
feature visible for the first time.

Three things are wrong today. The answer reveal is already implemented and has
never been seen by anyone. The interface borrows nothing from its own subject —
market data set in the same face as body prose, in a card occupying a third of
the viewport. And a round carries no stakes: ten questions pass with no feedback
beyond `1 / 10` in small grey text.

Scope is the deck and the landing page. The report keeps its content and inherits
the new type and palette only.

## The Bug This Starts From

`app.ts` `commit()` throws the card off screen and *then* calls `reveal()`:

```ts
card.style.transform = `translateY(${given === "up" ? -140 : 140}%)`;
reveal(given);
```

Measured during an answer, the card's bottom edge crosses the top of the viewport
at ~311ms and stays outside it until 1399ms. `reveal()` paints the true future
bars from 0–600ms and then holds 900ms — the entire sequence renders into a canvas
above the top of the window.

So the feature exists, works, and is thrown away every single time. Everything
below is built on top of fixing that ordering.

## Design Direction

The subject has a vernacular the interface currently ignores: tape readers,
terminals, monospace numerals, the tape itself. The name already promises it.

**Signature: the tape.** One strip across the top of the deck that *is* the round.
Each answer stamps a glyph. It is the score display the game lacks, it explains
the mechanic on the landing page, and at round end it is the artifact of the run.

Boldness is spent there. Everything around it stays quiet.

### Colour

The chrome stops competing with the data for the same semantics.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--paper` | `#F7F5F1` | `#101114` | page ground |
| `--surface` | `#FFFFFF` | `#191B1F` | the card |
| `--amber` | `#C97A21` | `#E9A542` | chrome only — tape cursor, live streak |
| `--good` / `--bad` | unchanged | unchanged | candles only |
| viz palette | unchanged | unchanged | report |

Green and red stay locked to the candlesticks. The existing comment at
`style.css:14-23` establishes why the report uses a blue/red diverging pair
instead — that reasoning holds and nothing here changes it. Amber is chrome and is
never the carrier of an up/down or right/wrong meaning.

### Type

No webfont and no new binary assets. All *data* moves to a monospace stack with
tabular figures; prose stays on the system sans.

```css
--font-data: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Menlo, monospace;
--font-prose: system-ui, -apple-system, "Segoe UI", sans-serif;
```

Monospace covers the tape, streak, progress, card meta line, speed read-out and
every number in the report. The `tickread` wordmark is set in the same face,
lowercase and tightly tracked, so it reads as a terminal prompt.

This is the restraint call: market data is monospace everywhere in the real world,
so the correct choice for the subject also happens to cost zero bytes.

### Layout

The card fills the available viewport rather than sitting at a fixed 340px. The
canvas grows with it. Mobile first — it is a swipe game — with the desktop width
capped and the height taken up by the chart.

## The Tape

Glyph **shape** carries the call, glyph **fill** carries the outcome, colour only
reinforces. Outcome stays readable without colour, matching the discipline already
established for the report visualisations.

```
▲ ▼ ▲ ▲ ▽ ▲ ▮                                    streak 2
        └── hollow: called up, was wrong
                  ▮ live cursor, amber
```

- Filled triangle — hit. Hollow triangle — miss.
- Pointing up — you called up. Pointing down — you called down.
- Green tints an up call, red a down call. Reinforcement, never the only cue.
- The live cursor sits at the current position in amber.

Current streak sits at the right in amber and resets visibly on a miss.

### Interfaces

New module `src/tape.ts`. Pure, no DOM.

```ts
import type { AnswerRecord, Direction } from "./types.js";

export interface TapeGlyph {
  /** The direction the player called. */
  call: Direction;
  /** Whether that call was right. */
  hit: boolean;
}

/** One glyph per answered question, in the order they were answered. */
export function tapeGlyphs(records: readonly AnswerRecord[]): TapeGlyph[];

/** Consecutive hits ending at the most recent record. 0 if the last was a miss. */
export function currentStreak(records: readonly AnswerRecord[]): number;

/** The longest run of consecutive hits anywhere in the records. */
export function bestStreak(records: readonly AnswerRecord[]): number;
```

All three return 0 or `[]` for empty input.

## The Speed Read-out

`AnswerRecord.responseMs` is already recorded on every answer and is already
consumed by `persona.ts` as `decisionSpeedMs`. It has never been shown in-round.

It appears with the verdict as a single figure — `0.8s` — in the data face. No
countdown, no penalty, no threshold. Rewarding a fast gut call without punishing
thought.

## Answer Sequencing

`commit()` no longer removes the card. The reveal happens where the player is
looking.

| Time | Behaviour |
| --- | --- |
| 0ms | Release. Card springs back to `translateY(0)` over 180ms. Border takes the colour of **the call, not the outcome** — green for up, red for down, whether or not it turns out right. A `▲ YOU SAID UP` chip pins to the corner. Colouring by outcome here would spoil the reveal before it draws. |
| 0–600ms | True future bars paint into the forecast zone, left to right. `REVEAL_MS`, unchanged. |
| 600ms | Verdict line resolves. Speed appears. Tape stamps its glyph; streak updates. |
| 600–1500ms | `HOLD_MS` beat to read the shape that actually happened. |
| 1500ms | Cross-fade to the next chart. |

The `.hint-up` / `.hint-down` badges stay bound to the *drag*. They tell the
player which way they are about to commit, which is useful. They stop being the
only feedback an answer produces.

The timeline is extracted so it can be tested without a browser, exported from
`app.ts` alongside `shouldCommit` and tested the same way:

```ts
export interface RevealFrame {
  /** Bars of the future to draw. Never below 1 once the reveal starts. */
  revealCount: number;
  /** True once the full future is drawn and the hold has elapsed. */
  done: boolean;
}

export function revealTimeline(elapsedMs: number, steps: number): RevealFrame;
```

## The Landing Page

A card above the Start button plays a real chart on loop: candles settle, a ghost
card swipes up, the true bars reveal, a beat, then the next chart. It teaches the
gesture and shows the payoff before the player commits to a round.

The tape sits above it and fills in with the *demo's* calls, at reduced opacity,
as an illustration of what the strip means. It is explicitly not the player's
tape: pressing Start clears it and the round begins on an empty strip. Nothing the
demo does is written to history or counted in any statistic.

New module `src/demo.ts`. Pure function of elapsed time, no DOM — `app.ts` owns
the requestAnimationFrame loop and the painting, preserving the rule that only
`app.ts` touches the document.

```ts
import type { Direction } from "./types.js";

export type DemoPhase = "settle" | "poise" | "swipe" | "reveal" | "rest";

export interface DemoFrame {
  phase: DemoPhase;
  /** Bars of the future to draw. 0 before the reveal phase. */
  revealCount: number;
  /**
   * Vertical offset of the ghost card as a fraction of its own height:
   * -1 is one card-height up, 0 is at rest. Normalised rather than pixels so the
   * function stays independent of layout — `app.ts` scales it when painting.
   */
  cardOffset: number;
  /** The call the ghost hand is making, or null before it commits. */
  direction: Direction | null;
  /** 0–1, for fading the hand marker in and out. */
  handOpacity: number;
}

/** Total length of one demo cycle. */
export const DEMO_CYCLE_MS: number;

/** Frame state at a point in the cycle. Wraps: elapsed beyond the cycle is modulo. */
export function demoFrame(elapsedMs: number, horizonBars: number): DemoFrame;
```

The loop pauses when the view is not `start` and when `document.hidden` is true.
Under `prefers-reduced-motion` the demo renders a single static, fully revealed
chart and never animates.

## Demo Data

The shipped shards are 0.87–1.8 MB each. Loading one to animate a landing page is
not defensible, so `build_deck.py` gains a fourth output: `data/demo.json`,
holding four questions chosen for legibility, a few KB, fetched at boot.

The four ids ship inside that file. `app.ts` seeds them into the `seen` set that
`buildRound(DATA_URL, { seen })` already accepts, so a player is never dealt a
chart whose answer they just watched. No new exclusion machinery — the existing
mechanism covers it.

If `demo.json` fails to load the landing page renders without the demo card and
the Start button still works. The demo is an enhancement, never a gate.

## Module Changes

| File | Change |
| --- | --- |
| `src/tape.ts` | New. Pure. Glyphs and streaks. |
| `src/demo.ts` | New. Pure. Landing-page animation state. |
| `src/report-view.ts` | Extracted from `app.ts`. Report HTML, unchanged in behaviour. |
| `src/app.ts` | Reordered commit/reveal, tape rendering, speed, demo loop, `revealTimeline`. |
| `src/chart.ts` | Unchanged. |
| `src/deck.ts` | Unchanged — demo exclusion rides the existing `seen` set. |
| `scripts/build_deck.py` | Also writes `data/demo.json`. |
| `index.html` | Tape, streak, speed and demo-card nodes. |
| `style.css` | New tokens, data face, full-bleed card, tape. |

`app.ts` is 858 lines, roughly 400 of them report HTML. Since this work adds to
that file, the report rendering moves to `src/report-view.ts` first. This is a
targeted extraction in code being worked in, not general refactoring — no
behaviour changes and the report output is byte-identical.

## Testing

| Target | Coverage |
| --- | --- |
| `tape.test.ts` | Glyph mapping for all four call/outcome combinations; streak resets on a miss; `bestStreak` across several runs; empty records. |
| `demo.test.ts` | Phase boundaries; `revealCount` monotonic within a cycle; cycle wraps at `DEMO_CYCLE_MS`; `cardOffset` is 0 during `settle` and `rest`. |
| `app.test.ts` | `revealTimeline` at 0, mid-reveal, exactly `REVEAL_MS`, and past the hold. Existing `shouldCommit` cases unchanged. |
| `integration.ts` | Element contract extended to the new nodes; `demo.json` present, parseable, and its ids resolvable. |
| Browser | Playwright: answer a question and assert the card's bounding box stays within the viewport while `revealCount` climbs. This is the assertion whose absence let the original bug ship. |

## Quality Floor

Responsive to mobile. Visible keyboard focus on Start, the mode buttons and the
card. `prefers-reduced-motion` honoured by the demo loop, the reveal and the
cross-fade. Nothing about the tape depends on colour alone.

## Not Doing

- **The report screen.** Inherits type and palette; content untouched.
- **Shareable tape and daily chart.** Both were considered and cut for this pass.
- **Prefetching a shard during the demo** to shorten the post-Start wait. A real
  improvement, and a separate change.
- **A webfont.** The monospace stack does the work without shipping binaries.
