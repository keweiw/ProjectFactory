# Stats

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Turns a list of answer records into the report's scorecard: overall accuracy plus
accuracy split by asset class, timeframe, and prediction horizon — each with a
Wilson 95% confidence interval and a significance verdict.

This module carries the product's honesty constraint. Twenty questions split three
ways is inherently sparse; without interval-based gating the report would present
noise as insight. `src/stats.ts` is where that gate lives.

Pure and DOM-free.

## Interfaces

```ts
export interface Interval { low: number; high: number }   // both clamped to [0, 1]

export type Significance = "strength" | "weakness" | "inconclusive";

export interface BucketStat {
  key: string;              // "equity" | "1d" | "5" — the bucket's value as a string
  correct: number;
  total: number;
  accuracy: number;         // correct / total; 0 when total === 0
  interval: Interval;
  significance: Significance;
}

export interface Scorecard {
  overall: BucketStat;
  byAssetClass: BucketStat[];
  byTimeframe: BucketStat[];
  byHorizon: BucketStat[];
}

/** Wilson score interval. `z` defaults to 1.96 (95%). */
export function wilsonInterval(successes: number, trials: number, z?: number): Interval;

export function classify(interval: Interval, total: number): Significance;

export function buildScorecard(records: readonly AnswerRecord[]): Scorecard;
```

`AnswerRecord` is defined by the session spec and declared in `src/types.ts`. This
module only reads `assetClass`, `timeframe`, `horizon`, and `correct` from it.

## Data Model

Owns `Interval`, `Significance`, `BucketStat`, `Scorecard`. Owns no persisted state.

## Behaviour

### `wilsonInterval`

With `p̂ = successes / trials`:

```
denom  = 1 + z² / n
centre = (p̂ + z² / (2n)) / denom
margin = (z / denom) · √( p̂(1 − p̂)/n + z² / (4n²) )
```

Returns `{ low: clamp(centre − margin), high: clamp(centre + margin) }`, clamped
to `[0, 1]`.

Edge cases:

- `trials === 0` → `{ low: 0, high: 1 }`. No division is attempted.
- `successes === 0` or `successes === trials` → the formula is well defined and must
  be used; do not special-case it to `[0, x]` or `[x, 1]`.
- `successes > trials`, or either argument negative or non-integer → throw
  `RangeError`. This is a programming error, not user input.

### `classify`

```
total >= 8 && interval.low  > 0.5  →  "strength"
total >= 8 && interval.high < 0.5  →  "weakness"
otherwise                          →  "inconclusive"
```

Comparisons are **strict**. An interval whose bound lands exactly on `0.5` does not
clear it, and is inconclusive. The threshold of 8 and the 95% level are fixed here
and in DESIGN.md; changing either requires raising it with the human.

### `buildScorecard`

1. `overall` is computed over every record, with `key: "overall"`.
2. For each of the three dimensions, group records by that field and produce one
   `BucketStat` per **observed** value. Buckets with no records are not emitted —
   the report must not show empty rows for asset classes the bank never covered.
3. Each dimension's array is sorted by a fixed presentation order, not by count:
   - asset class: `equity`, `etf_index`, `future`, `crypto`
   - timeframe: `1m`, `1h`, `1d`, `1mo`
   - horizon: `1`, `5`, `20`
   Values outside these orders sort last, alphabetically. This keeps the report
   stable between rounds instead of reshuffling as counts change.
4. `buildScorecard([])` returns a valid `Scorecard`: `overall` with `total: 0`,
   `accuracy: 0`, `interval: {low: 0, high: 1}`, `significance: "inconclusive"`, and
   three empty arrays. It does not throw.

The same function serves both report modes. "This round" passes the session's
records; "all time" passes the full persisted history. There is no separate code
path for cumulative statistics.

### Error handling

There is no user-facing error surface. Malformed input is a caller bug and throws.
The caller (`app.ts`) is responsible for never passing records it did not build.

## Dependencies

- `src/types.ts` for `AssetClass`, `Timeframe`, `Horizon`, `AnswerRecord`, and the
  types above. Imports nothing from any other component.
- No DOM, no network, no storage.

## Testing Notes

Highest-priority module in the project. The interval maths is the one place where a
plausible-looking wrong implementation would silently corrupt every report.

**Known-good Wilson vectors** (z = 1.96, rounded to 4 dp) — assert against these,
not against a reimplementation of the formula:

| successes / trials | expected interval |
|---|---|
| 5 / 10 | `[0.2366, 0.7634]` |
| 8 / 10 | `[0.4902, 0.9433]` |
| 0 / 10 | `[0.0000, 0.2775]` |
| 10 / 10 | `[0.7225, 1.0000]` |
| 1 / 1  | `[0.2065, 1.0000]` |

Also cover:

- `trials === 0` returns `[0, 1]` and does not divide by zero.
- Bounds never escape `[0, 1]` for any `successes ≤ trials ≤ 200`.
- Interval width shrinks monotonically as `n` grows at fixed `p̂` (e.g. 5/10, 50/100,
  500/1000).
- `RangeError` on `successes > trials`, negatives, and non-integers.

`classify` boundaries — construct intervals directly rather than deriving them:

- `low` exactly `0.5` with `total = 20` → `inconclusive` (strictness check)
- `high` exactly `0.5` with `total = 20` → `inconclusive`
- `low = 0.5001, total = 8` → `strength`; same interval at `total = 7` →
  `inconclusive` (the n-gate)
- An interval straddling `0.5` at any `total` → `inconclusive`

`buildScorecard`:

- Empty input returns the documented empty shape without throwing.
- Records confined to one asset class emit exactly one entry in `byAssetClass` and
  no empty siblings.
- Bucket totals sum to `overall.total` across each dimension independently.
- Presentation order holds even when input is shuffled and counts are uneven.

## Open Items

None.
