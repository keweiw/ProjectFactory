# Advice

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Turns the scorecard into a verdict a human would repeat to a friend — "The Reverse
Indicator", "A monthly Specialist" — plus the round-by-round series the report plots
as a trend.

This is the module most tempted to lie. "You are a monthly trader" is a far more
satisfying thing to read than "not enough data", and it is one line of code away. So
it enforces the **same gate `stats.ts` does**: nothing is claimed until a bucket has
at least `MIN_SAMPLE` answers *and* its 95% interval excludes 50%. Until then the
verdict says so and shows how far off it is. `DESIGN.md` calls that gate
non-negotiable; this module is the place where breaking it would be invisible.

Pure and DOM-free. It computes strings, not markup — `app.ts` owns all rendering.

## Interfaces

```ts
export interface AdviceProgress {
  answers: number;             // answers recorded so far
  target: number | null;       // answers needed before the interval would clear 50%
  roundsLeft: number | null;   // whole rounds still to play; null when target is null
}

export interface Advice {
  title: string;
  body: string;
  suggestion: string | null;
  progress: AdviceProgress | null;   // present only while unsettled
  settled: boolean;
}

export function buildAdvice(
  scorecard: Scorecard,
  persona: PersonaResult,
  roundSize: number,
): Advice;

/** Smallest sample at which `accuracy` would clear 50%; null if it never would. */
export function answersNeededForVerdict(accuracy: number, from: number): number | null;

/** Accuracy per completed round, oldest first. Trailing partial round dropped. */
export function roundAccuracies(
  records: readonly { correct: boolean }[],
  roundSize: number,
): number[];

// --- the character sheet ---

export interface ShapeAxis {
  label: string;
  value: number;    // 0..1, 0.5 is the neutral middle
  unknown: boolean; // the metric was null; 0.5 is a placeholder, not a measurement
}
export function personaShape(metrics: PersonaMetrics): ShapeAxis[];

export interface Grade {
  letter: string;      // S A B C D F, or "–" for an empty history
  provisional: boolean;
}
export function gradeFor(overall: BucketStat): Grade;

export type SkillState = "locked" | "open" | "cleared" | "failed";

export interface SkillCell {
  timeframe: Timeframe;
  horizon: Horizon;
  total: number;
  correct: number;
  accuracy: number | null;
  state: SkillState;
}
export function skillGrid(records: readonly AnswerRecord[]): SkillCell[];

/** Answers still needed before a cell could possibly be called. */
export function answersToUnlock(cell: SkillCell): number;
```

`roundSize` is a parameter rather than an import so this module stays free of
`deck.ts` and its `fetch` surface. `roundAccuracies` takes a structural
`{ correct: boolean }` rather than `AnswerRecord` so the trend can be computed from
anything that records a hit.

## Data Model

Owns `Advice` and `AdviceProgress`. Consumes `Scorecard`, `BucketStat`,
`PersonaResult`. Persists nothing.

## Behaviour

### Verdict selection

Checked in order; the first match wins:

1. **`overall.significance === "weakness"`** → *The Reverse Indicator*. Being
   dependably wrong clears the same bar as being dependably right, and is the more
   interesting finding.
2. **`overall.significance === "strength"`** → *Reads the Tape*.
3. **Any bucket is a `strength`** (overall inconclusive) → *A &lt;bucket&gt;
   Specialist*. The average is hiding a real edge.
4. **Any bucket is a `weakness`** (overall inconclusive) → *Blind Spot:
   &lt;bucket&gt;*. One bucket is dragging an otherwise even record.
5. **Nothing significant** → *No verdict yet*, with `progress`.

Buckets are drawn from all three groupings (timeframe, asset class, horizon) and
ranked by sample size, so the verdict quotes the best-supported one rather than the
most extreme one.

### The projection

`answersNeededForVerdict` walks `n` upward from the current total and returns the
first `n` at which a Wilson interval built from that accuracy excludes 0.5, capped
at 2000.

The answer genuinely depends on the observed rate — at 90% the interval clears in a
couple of rounds, at 55% it takes hundreds of answers, and at exactly 50% it never
clears. Returning `null` for that last case is correct and is surfaced as a finding
("you are indistinguishable from chance"), not as a failure.

### Copy rules

- Percentages only. No ticker, no date, nothing year-like — the anonymisation rule
  reaches the copy layer too.
- Never emits `NaN`, `undefined`, or an unsubstituted template.
- Tone is dry and mildly needling, never insulting. The user is allowed to be bad at
  this; the copy makes that funny rather than shaming.
- Copy is **English**, matching the rest of the product.

### `roundAccuracies`

Chunks records into fixed-size rounds, oldest first, and drops a trailing partial
round: a point built from three answers swings to 0% or 100% on the next card and
reads as a collapse in form when it is only a small denominator. A `roundSize` of
`0` or less is floored to 1 rather than dividing by zero.

### The character sheet

The report is a game, not a dashboard, so the same numbers are also served as
things to look at and chase. **None of it relaxes the significance rule**; the trick
is that the rule turns out to be a good game mechanic in its own right.

**`personaShape`** normalises the four persona axes onto a common `0..1` scale in a
fixed order, so the radar outline is a stable silhouette for a given player. A null
metric plots at the centre *and* sets `unknown`, which the renderer draws as a
hollow vertex — an outline where every vertex looked equally solid would state four
findings when only two were measured.

**`gradeFor`** returns a letter (S/A/B/C/D/F) plus `provisional`. The letter is
always computed, because a game needs one; `provisional` is true until the interval
clears 50%, and the renderer must then draw it as a dashed outline rather than a
solid badge. The visual weight has to match what the number is actually worth.

**`skillGrid`** returns all twelve `(timeframe, horizon)` cells, always — including
ones never played. Cell states:

| State | Meaning |
|---|---|
| `locked` | no answers at all; shown as `?`, never as 50% |
| `open` | played, but the interval still spans 50% — genuinely undecided |
| `cleared` | significant strength |
| `failed` | significant weakness — a result, not an absence |

This is the fog-of-war reading of the significance gate: a cell you have not earned
enough data for is *unknown*, with the answers still needed, rather than a
confident-looking number. It reframes the report's refusal to guess as a reward to
chase instead of a lecture, which is the only way a statistically honest game stays
fun. `answersToUnlock` counts down to `MIN_SAMPLE` and floors at zero.

Note that a cell reaching `MIN_SAMPLE` is **necessary but not sufficient** — the
interval must also clear 50%, so a cell can sit at `open` with 40 answers. The copy
says so, because otherwise "8+ answers" reads as a promise.

### Edge cases

- Empty history → unsettled, `title` still populated, no placeholders in the copy.
- Empty history → all twelve cells `locked`, every `accuracy` null, grade `–` and
  provisional.
- A metric outside its axis range is clamped rather than plotted off the radar.
- `overall.total === 0` → the "nothing answered yet" branch; no division by total.
- A settled verdict always has `progress === null`; an unsettled one always has it.

## Dependencies

- `src/stats.ts` for `wilsonInterval`
- `src/types.ts` for `Scorecard`, `BucketStat`, `PersonaResult`

Nothing imports `advice.ts` except `app.ts`, so the module graph stays acyclic.

## Testing Notes

- The projection returns a sample whose interval genuinely clears 50% when rebuilt —
  the test recomputes the interval rather than trusting the number.
- A stronger edge needs a smaller sample than a weaker one.
- Accuracy below 50% is reachable too; exactly 50% returns `null`.
- The projection never proposes fewer answers than are already recorded.
- **Gate tests**, the important ones: ten answers can never settle anything; a
  significant bucket settles the verdict even when the overall is a coin flip; a
  settled verdict carries no progress bar.
- Fixtures are chosen against real Wilson intervals (e.g. monthly 26/46 stays
  inconclusive while daily 2/24 clears from below, leaving the overall at 28/70 and
  inconclusive) so a branch cannot be reached by accident.
- No copy path emits `NaN`, `undefined`, `null`, or `${`, across empty, all-wrong,
  all-right, significant-low, significant-high, and exact-coin-flip histories.
- `roundAccuracies` drops the partial round, preserves order, and survives a
  degenerate size.

## Open Items

None.
