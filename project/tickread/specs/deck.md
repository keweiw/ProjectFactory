# Deck

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Assembles one round of 20 questions. Reads the manifest to learn what the bank
actually contains, lazily loads only the shards it needs, draws a stratified sample
across timeframes and horizons, prefers questions the user has not seen, and repairs
the up/down balance of the drawn round.

The stratification and the balance repair are what make the report interpretable.
A uniform random draw would leave some report buckets empty and could hand the user
a round that is 15 up — against which swiping right on everything scores 75% and the
scorecard lies.

The network functions are thin and isolated; `drawDeck` is pure and holds all the
logic.

## Interfaces

```ts
export interface DeckOptions {
  size?: number;                    // default 20
  seen?: ReadonlySet<string>;       // default empty
  random?: () => number;            // default Math.random; inject for determinism
}

export async function loadManifest(baseUrl: string): Promise<Manifest>;

export async function loadShard(baseUrl: string, shard: ShardInfo): Promise<Question[]>;

export function drawDeck(
  pool: readonly Question[],
  options?: DeckOptions,
): Question[];

/** Convenience: manifest → shards → draw. Used by app.ts. */
export async function buildRound(
  baseUrl: string,
  options?: DeckOptions,
): Promise<Question[]>;
```

`baseUrl` is a **relative** path such as `"./data"`. The site is served from a
subpath on GitHub Pages, so an absolute path would break deployment.

## Data Model

Owns `DeckOptions`. Consumes `Question`, `Manifest`, and `ShardInfo` from the data
pipeline; persists nothing itself.

## Behaviour

### Loading

1. `loadManifest` fetches `<baseUrl>/manifest.json` and validates that `version` is
   `1` and `shards` is a non-empty array. Anything else throws.
2. `buildRound` loads **all** shards listed in the manifest. At roughly 1 MB gzipped
   for the whole bank this is acceptable, and it keeps stratification simple by
   giving the draw the full pool.
3. Shards are fetched in parallel. A shard that fails to load is logged and skipped;
   the round is drawn from whatever loaded. Only if **every** shard fails does
   `buildRound` throw.

### `drawDeck` — stratified selection

1. Group the pool into strata keyed by `(timeframe, horizon)`. Only strata actually
   present are considered, so a bank missing intraday data still produces a round.
2. Shuffle each stratum with a Fisher–Yates shuffle driven by `options.random`.
   Within a stratum, order **unseen questions before seen ones** so the user
   exhausts fresh material before repeating.
3. Round-robin across strata in a shuffled stratum order, taking one question at a
   time, until `size` is reached or the pool is exhausted. Round-robin rather than
   proportional allocation keeps thin strata represented — otherwise a bank with far
   more daily than monthly questions would rarely show a monthly chart.
4. Run the balance repair below.
5. Return the selected questions in a final shuffled order, so the user cannot infer
   anything from the sequence in which strata appear.

### Balance repair

After selection, count `up` and `down` answers. While the difference exceeds 1:

- Pick a selected question whose answer is the over-represented direction.
- Look for an unselected question with the opposite answer **in the same stratum**;
  if none exists, allow any stratum.
- Swap them and recount.

This is **best effort**. If no swap candidate exists the imbalance is accepted and
the round proceeds — a slightly unbalanced round is better than a failed one, and
the bank is already balanced per bucket, so this only corrects sampling noise.

The loop is bounded by the number of selected questions to guarantee termination
even if a swap fails to improve the count.

### Edge cases

- `pool` smaller than `size` → return the whole pool, shuffled and balance-repaired.
- Empty pool → return `[]`. `app.ts` renders a data-error message; this is not an
  exception because an empty bank is a build problem, not a runtime fault.
- Every question already seen → the seen-preference is a sort key, not a filter, so
  the round is drawn normally from seen questions rather than coming back empty.
- `size` of `0` or negative → return `[]`.

### Error handling

- HTTP failure or invalid JSON on the manifest throws with the URL in the message;
  `app.ts` catches it and shows a load-failure view. This is the one genuinely
  user-visible failure in the app and must not surface as a blank screen.
- Individual shard failures degrade rather than throw, as above.

## Dependencies

- `src/types.ts` for `Question`, `Manifest`, `ShardInfo`, `Timeframe`, `Horizon`
- `fetch` — the only network use in the entire app, and only for same-origin static
  files under `data/`
- `storage.ts` supplies the `seen` set, but `deck.ts` does not import it; `app.ts`
  passes it in. This keeps `drawDeck` pure.

## Testing Notes

`drawDeck` is tested with a **seeded deterministic `random`** and fabricated
questions; no test touches the network.

- A pool spanning several strata produces a round of exactly `size`.
- Every stratum present in the pool appears in the round when `size` is at least the
  number of strata — the round-robin guarantee.
- Thin strata are not starved: a pool of 500 daily and 5 monthly questions yields
  monthly questions in the round.
- Unseen preference: with half the pool marked seen and `size` at a quarter of the
  pool, the round contains only unseen questions.
- All-seen pool still returns a full round.
- No duplicate question ids within a round.
- Balance: across many seeds, `|up − down| <= 1` whenever the pool can supply it.
- Balance repair terminates on a pool that is entirely one direction, returning an
  unbalanced round rather than looping.
- `pool` shorter than `size`, empty pool, and `size <= 0` return the documented results.
- Determinism: the same seed and pool produce the identical round twice.

`loadManifest` and `loadShard` are tested against a stubbed `fetch`: a valid
payload, a 404, malformed JSON, and a manifest with the wrong `version`.
`buildRound` is tested for the partial-shard-failure path and the all-shards-fail path.

## Open Items

None.
