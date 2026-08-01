# Persona

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Derives the report's behavioural profile: how the user decides, independent of
whether they were right. Because no metric here depends on correctness, the profile
is meaningful from the very first round — unlike the scorecard, which needs volume
before it can say anything.

Also owns `extractFeatures`, which reduces a question to the three chart properties
the metrics are defined against. Features are computed **at answer time** and stored
inside the answer record, so cumulative history stays self-contained after the
question shards it came from are gone.

Pure and DOM-free.

## Interfaces

```ts
export interface QuestionFeatures {
  tailTrend: -1 | 0 | 1;   // sign(setup[59].c − setup[49].c)
  volumeSurge: boolean;    // mean(volume of last 5) > 1.5 × mean(volume of all 60)
  realisedVol: number;     // sample stdev of log returns across setup; >= 0
}

export interface PersonaMetrics {
  bullBias: number | null;              // [0, 1]
  momentumScore: number | null;         // [−1, 1]
  volumeSensitivity: number | null;     // [−1, 1]
  volatilitySensitivity: number | null; // [−1, 1]
  decisionSpeedMs: number | null;
  consistency: number | null;           // [0.5, 1]
}

export type MomentumAxis = "momentum" | "neutral" | "contrarian";
export type BiasAxis     = "bull" | "balanced" | "bear";

export interface PersonaResult {
  metrics: PersonaMetrics;
  momentumAxis: MomentumAxis | null;
  biasAxis: BiasAxis | null;
  label: string | null;    // null when either axis is null
}

export function extractFeatures(question: Question): QuestionFeatures;

export function computePersona(records: readonly AnswerRecord[]): PersonaResult;
```

`null` means **not computable from this sample**, and the UI must render it as
"not enough data" rather than as zero. A metric whose denominator is empty is not
a neutral score; conflating the two would invent a personality out of nothing.

## Data Model

This spec is authoritative for `QuestionFeatures`, `PersonaMetrics`, `MomentumAxis`,
`BiasAxis`, and `PersonaResult`. All of them are **declared in `src/types.ts`** —
see DESIGN.md § Runtime Architecture for why shared types do not live in the module
that defines them.

`QuestionFeatures` is embedded in `AnswerRecord` and therefore persisted; a change
to its shape requires bumping the storage key version.

## Behaviour

### `extractFeatures`

Given a question with a 60-bar setup:

- `tailTrend` = `Math.sign(setup[59].c − setup[49].c)`, i.e. the last 10 bars.
- `volumeSurge` = `mean(v of setup[55..59]) > 1.5 × mean(v of setup[0..59])`.
- `realisedVol` = sample standard deviation (denominator `n − 1`) of
  `ln(setup[i].c / setup[i−1].c)` for `i` in `1..59`, giving 59 returns.

The data pipeline guarantees positive prices and volumes, so no guard against
`log(0)` or division by zero is needed. A setup shorter than 60 bars is a caller
bug and throws `RangeError`.

### `computePersona`

All metrics are computed over the records passed in — the current round in "this
round" mode, the full persisted history in "all time" mode. There is no separate
cumulative path.

Let `R` = right swipes (`given === "up"`), `N` = total records.

| Metric | Rule | `null` when |
|---|---|---|
| `bullBias` | `R / N` | `N === 0` |
| `momentumScore` | `P(right \| tailTrend === 1) − P(right \| tailTrend === −1)` | either group is empty |
| `volumeSensitivity` | `P(right \| volumeSurge) − P(right \| !volumeSurge)` | either group is empty |
| `volatilitySensitivity` | `P(right \| high vol) − P(right \| low vol)` | either group is empty, or `N < 4` |
| `decisionSpeedMs` | median `responseMs` | `N === 0` |
| `consistency` | see below | no bin reaches `n ≥ 3` |

Records with `tailTrend === 0` are excluded from **both** groups of
`momentumScore`. They are not evidence either way.

`volatilitySensitivity` splits at the **median `realisedVol` of the records being
reported on**, not a fixed threshold. Records at or below the median are "low", the
rest "high". With `N < 4` the split is too degenerate to mean anything, so the
metric is `null`.

`consistency`:

1. Bin every record by `(tailTrend, volatility tercile)`. Terciles are computed over
   the same record set, giving at most 9 bins.
2. Keep bins with `n ≥ 3`. If none qualify, return `null`.
3. For each kept bin, take the share held by whichever answer is more common —
   always in `[0.5, 1]`.
4. Return the **unweighted mean** across kept bins, so one large bin cannot dominate.

Median for `decisionSpeedMs` and for the volatility split is the standard
definition: the mean of the two middle values when `N` is even.

### Axes and label

```
momentumScore >= +0.15  → "momentum"      bullBias >= 0.60  → "bull"
momentumScore <= −0.15  → "contrarian"    bullBias <= 0.40  → "bear"
otherwise               → "neutral"       otherwise         → "balanced"
```

Comparisons are inclusive at the thresholds shown. An axis is `null` when its
underlying metric is `null`, and `label` is `null` if either axis is.

| | bull | balanced | bear |
|---|---|---|---|
| **momentum** | Trend Surfer | Momentum Hunter | Breakdown Chaser |
| **neutral** | Optimistic Drifter | Coin Flipper | Pessimistic Drifter |
| **contrarian** | Dip Buyer | Mean Reverter | Top Seller |

The nine labels are exhaustive — every axis pair maps to exactly one, and the
implementation must not fall through to a default string.

### Error handling

No user-facing error surface. `computePersona([])` returns a `PersonaResult` with
every metric, both axes, and the label set to `null`; it does not throw.
`extractFeatures` throws `RangeError` on a malformed question, which is a caller bug.

## Dependencies

- `src/types.ts` for `Question`, `Bar`, `Direction`, `AnswerRecord`, and the types
  above. **`persona.ts` imports nothing from `session.ts`** — the dependency runs
  one way only.
- No DOM, no network, no storage.

## Testing Notes

Second-highest priority after `stats`. The failure mode to guard against is a metric
that returns `0` where it should return `null` — that fabricates a personality from
an empty sample, which is exactly what this design is trying to avoid.

`extractFeatures`:

- `tailTrend` at each sign, including `setup[59].c === setup[49].c` giving exactly `0`.
- `volumeSurge` at the boundary: a ratio of exactly `1.5` is **not** a surge.
- `realisedVol` of a perfectly flat series is `0`; of a known series, matches a
  hand-computed value.
- `RangeError` on a setup of length 59 or 61.

`computePersona` — every `null` path gets its own test:

- Empty input: all metrics, axes, and label `null`.
- All records `tailTrend === 1`: `momentumScore` is `null`, but `bullBias` is not.
- All records `tailTrend === 0`: `momentumScore` is `null` (both groups empty).
- No surges: `volumeSensitivity` is `null`.
- `N === 3`: `volatilitySensitivity` is `null`; at `N === 4` it computes.
- Every bin under 3 records: `consistency` is `null`.

Value checks:

- All-right swipes: `bullBias === 1`, and `momentumScore === 0` when both trend
  groups are present — a distinct case from `null`, and the test must assert the
  difference explicitly.
- `consistency` is unweighted: one bin of 30 at 0.5 and one bin of 3 at 1.0 gives
  `0.75`, not something closer to `0.5`.
- Median `responseMs` over an even count is the mean of the middle two.

Label boundaries — all nine cells, plus each threshold from both sides:

- `momentumScore` of exactly `0.15` → `"momentum"`; `0.1499` → `"neutral"`
- `momentumScore` of exactly `−0.15` → `"contrarian"`
- `bullBias` of exactly `0.60` → `"bull"`; exactly `0.40` → `"bear"`; `0.5` → `"balanced"`
- One axis `null` → `label` is `null` even when the other axis resolves

## Open Items

None.
