# Session

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Holds the state of one round: which questions were drawn, which one is current, and
what the user answered. Owns `AnswerRecord`, the unit of record that every other
part of the report is computed from and that `storage.ts` persists.

Pure and DOM-free. State transitions return new objects rather than mutating, which
keeps the round trivially testable and makes an accidental double-submit from the
gesture handler harmless rather than corrupting.

## Interfaces

```ts
export interface AnswerRecord {
  questionId: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  horizon: Horizon;
  given: Direction;        // what the user swiped
  answer: Direction;       // what actually happened
  correct: boolean;        // given === answer
  responseMs: number;      // >= 0
  features: QuestionFeatures;
  ts: number;              // Date.now() when answered
}

export interface SessionState {
  readonly questions: readonly Question[];
  readonly index: number;              // 0 .. questions.length
  readonly records: readonly AnswerRecord[];
}

export function createSession(questions: readonly Question[]): SessionState;

export function currentQuestion(state: SessionState): Question | null;

export function isFinished(state: SessionState): boolean;

/** Returns a new state with the answer recorded and the index advanced. */
export function answer(
  state: SessionState,
  given: Direction,
  responseMs: number,
  now?: () => number,      // injectable clock; defaults to Date.now
): SessionState;

export function progress(state: SessionState): { answered: number; total: number };
```

## Data Model

This spec is authoritative for `AnswerRecord` and `SessionState`, but both are
**declared in `src/types.ts`**, not here. `session.ts` needs `extractFeatures` from
`persona.ts` as a value import, so declaring `AnswerRecord` in `session.ts` would
create a module cycle. See DESIGN.md § Runtime Architecture.

`AnswerRecord` is **persisted** by `storage.ts` and consumed by `stats.ts` and
`persona.ts`. It is deliberately self-contained: it carries the question's
classification and its extracted features rather than a reference to the question,
so history survives after the shard the question came from is no longer loaded.
Any change to its shape requires bumping the storage key version.

## Behaviour

### Happy path

1. `createSession(questions)` returns `{ questions, index: 0, records: [] }`.
2. `currentQuestion` returns `questions[index]`.
3. The UI records the timestamp at which the card became visible; on swipe it calls
   `answer(state, given, responseMs)`.
4. `answer` builds an `AnswerRecord` from the current question — computing `correct`
   from `given === question.answer` and `features` via `extractFeatures(question)` —
   appends it, and returns a new state with `index + 1`.
5. After the last question `index === questions.length`, `isFinished` is `true` and
   `currentQuestion` returns `null`. The UI switches to the report view.

### Edge cases

- `createSession([])` is valid and immediately finished. The UI must treat this as a
  data error and show a message, not a blank card — an empty question bank is the
  realistic cause.
- `answer` on a finished state throws `RangeError`. Advancing past the end is a
  caller bug, and silently ignoring it would hide a broken gesture handler.
- `responseMs` is clamped to a minimum of `0`. A negative value can arise from a
  clock adjustment mid-round and must not poison the median.
- The input array is defensively copied in `createSession`, so a caller mutating it
  afterwards cannot change a round in flight.

### Error handling

No user-facing error surface. Misuse throws; `app.ts` is responsible for only
calling `answer` when `isFinished` is false.

## Dependencies

- `src/types.ts` for `Question`, `AssetClass`, `Timeframe`, `Horizon`, `Direction`,
  `QuestionFeatures`, `AnswerRecord`, `SessionState`
- `extractFeatures` from `src/persona.ts` — the only value import, and the only edge
  between these two modules
- No DOM, no network, no storage.

## Testing Notes

- A full round: answers recorded in order, `index` advances by one each time,
  `isFinished` flips exactly at the end.
- `correct` is `true` only when `given === question.answer`; test both directions
  against both truths, all four combinations.
- `features` on the record equals `extractFeatures(question)` for that question.
- `answer` does not mutate the input state — the original's `index` and `records`
  are unchanged after the call.
- `answer` on a finished state throws `RangeError`.
- `createSession([])`: `isFinished` is `true`, `currentQuestion` is `null`,
  `progress` is `{ answered: 0, total: 0 }`.
- Negative `responseMs` is stored as `0`.
- `ts` uses the injected clock, so records are deterministic under test.
- Mutating the array passed to `createSession` afterwards does not affect the session.

## Open Items

None.
