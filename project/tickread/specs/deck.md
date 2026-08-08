# Deck

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Assembles one round of `DEFAULT_DECK_SIZE` questions — **10**. Reads the manifest to
learn what the bank actually contains, lazily loads only the shards it needs, draws a
stratified sample across timeframes and horizons, and prefers questions the user has
not seen.

The stratification is what makes the report interpretable. A uniform random draw
would leave report buckets empty.

The up/down mix is **left exactly as sampled**. The bank is balanced per bucket
offline by `build_deck.py::balance_buckets`, so a live round's imbalance is only
sampling noise — and swapping answers into a drawn round to correct it would bias
which charts the round can contain, which is the worse fault.

Ten rather than twenty: a round has to be finishable in one sitting for the
immediate-feedback loop to be worth anything. The statistics are unaffected, because
they come from all-time history, which accumulates across rounds regardless of round
length. The `n ≥ 8` significance gate is **unchanged**.

The network functions are thin and isolated; `drawDeck` is pure and holds all the
logic.

## Interfaces

```ts
export const DEFAULT_DECK_SIZE = 10;

export interface DeckOptions {
  size?: number;                    // default DEFAULT_DECK_SIZE (10)
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
4. Return the selected questions in a final shuffled order, so the user cannot infer
   anything from the sequence in which strata appear.

There is **no post-selection answer-balance repair**; see Purpose. A round's up/down
mix is whatever step 3 produced.

### Coverage

Twelve `(timeframe, horizon)` strata exist and a round is ten questions, so a round
covers **ten of the twelve** and is not required to cover them all. The round-robin
guarantee is that no stratum is starved across rounds, not that every stratum appears
in any one round.

### Edge cases

- `pool` smaller than `size` → return the whole pool, shuffled.
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

- `DEFAULT_DECK_SIZE` is `10`, and a draw with no explicit `size` returns ten.
- A pool spanning several strata produces a round of exactly `size`.
- Every stratum present in the pool appears in the round when `size` is at least the
  number of strata — the round-robin guarantee.
- Thin strata are not starved: a pool of 500 daily and 5 monthly questions yields
  monthly questions in the round.
- Unseen preference: with half the pool marked seen and `size` at a quarter of the
  pool, the round contains only unseen questions.
- All-seen pool still returns a full round.
- No duplicate question ids within a round.
- The sampled answer mix is **not** repaired: a pool whose first ten questions are
  all `up` yields a round that is all `up`.
- `pool` shorter than `size`, empty pool, and `size <= 0` return the documented results.
- Determinism: the same seed and pool produce the identical round twice.

`loadManifest` and `loadShard` are tested against a stubbed `fetch`: a valid
payload, a 404, malformed JSON, and a manifest with the wrong `version`.
`buildRound` is tested for the partial-shard-failure path and the all-shards-fail path.

## Open Items

None.
