# Storage

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Persists cumulative answer history and the set of already-served question ids in
`localStorage`. History is what makes the scorecard eventually significant — a
single 20-question round can almost never clear the `n ≥ 8` gate on a per-bucket
basis, so the report's "all time" mode depends entirely on this module.

Isolates every `localStorage` access in the app behind one interface, so the storage
backend is injectable and the whole module is testable without a browser.

## Interfaces

```ts
export interface HistoryStore {
  loadHistory(): AnswerRecord[];
  appendRecords(records: readonly AnswerRecord[]): void;
  loadSeen(): Set<string>;
  markSeen(ids: readonly string[]): void;
  clear(): void;
}

/** `storage` defaults to `window.localStorage`. Inject a fake in tests. */
export function createHistoryStore(storage?: Storage): HistoryStore;

export const HISTORY_KEY = "tickread.history.v1";
export const SEEN_KEY = "tickread.seen.v1";
export const HISTORY_CAP = 2000;
export const SEEN_CAP = 5000;
```

## Data Model

| Key | Stored value |
|---|---|
| `tickread.history.v1` | JSON array of `AnswerRecord`, oldest first |
| `tickread.seen.v1` | JSON array of question id strings, oldest first |

Seen ids are stored as an **array, not a set**, because eviction is by age and a set
has no order. `loadSeen` converts to a `Set` for the caller's lookups.

The `.v1` suffix is the migration mechanism. `AnswerRecord` embeds
`QuestionFeatures`, so a change to either shape means a new key — the old key is
then simply never read, and stale data ages out of the browser on its own. There is
no migration code.

## Behaviour

### Happy path

- `loadHistory` parses the key and returns the records oldest-first.
- `appendRecords` appends to the existing array, then trims from the **front** to
  `HISTORY_CAP`, and writes back.
- `markSeen` appends ids not already present, preserving order, then trims from the
  front to `SEEN_CAP`.
- `clear` removes both keys.

Caps exist because `localStorage` is a few megabytes per origin and a record with
embedded features is roughly 200 bytes. 2000 records is comfortably inside budget
while being far more history than the report needs.

### Edge cases and error handling

Every read is defensive. This module is the app's only contact with data it did not
create in this session — the user may have edited it, another tab may have written
it, or an old version may have left an incompatible shape.

- **Key absent** → return empty, do not write anything.
- **Malformed JSON** → return empty. Do not throw, do not clear the key; a transient
  parse failure should not destroy history that a later version might read.
- **Parsed value is not an array** → treat as empty.
- **Individual malformed records** → drop just those, keep the rest. A record is
  valid when it has a string `questionId`, a `given` and `answer` of `"up"` or
  `"down"`, a boolean `correct`, a finite non-negative `responseMs`, a finite `ts`,
  and a `features` object with a `tailTrend` of `-1 | 0 | 1`, a boolean
  `volumeSurge`, and a finite non-negative `realisedVol`. Anything else is dropped.
- **Write fails** (quota exceeded, or `localStorage` unavailable in private mode) →
  swallow the exception. The round completes and the report renders from in-memory
  records; only cumulative history is lost. Losing persistence must never break the
  session in progress.
- **`localStorage` throws on access** (some privacy modes throw on the property
  itself) → `createHistoryStore` catches this and returns a fully functional
  in-memory store, so the rest of the app has no special case to handle.

The validation above is the reason `stats.ts` and `persona.ts` can throw freely on
malformed input: nothing invalid gets past this boundary.

## Dependencies

- `src/types.ts` for `AnswerRecord` and `QuestionFeatures`. Imports nothing from any
  other component.
- The `Storage` interface only — never `window` directly, so tests inject a fake.

## Testing Notes

All tests run against an in-memory `Storage` fake; none touch a real browser store.

- Round trip: append, load, and get the same records back in order.
- Append accumulates across calls rather than replacing.
- `HISTORY_CAP`: appending past the cap drops the **oldest**, keeps the newest, and
  leaves length exactly at the cap.
- `SEEN_CAP` behaves the same, and `markSeen` does not duplicate an existing id.
- Absent key returns empty and writes nothing.
- Malformed JSON (`"{"`, `"null"`, `"42"`, `'"a string"'`) returns empty and does
  **not** delete the key.
- A mixed array of valid and invalid records keeps exactly the valid ones — with one
  case per validation rule listed above.
- A `Storage` fake whose `setItem` throws quota errors: `appendRecords` does not
  throw and `loadHistory` still returns what was previously stored.
- A `createHistoryStore` call where accessing the store throws returns a working
  in-memory store rather than propagating.
- `clear` removes both keys and leaves unrelated keys untouched.

## Open Items

None.
