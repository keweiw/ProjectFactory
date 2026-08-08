# App

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

The entry point and the only component that touches the DOM. Wires everything
together: switches between the three views, owns the swipe gesture and keyboard
input, drives the reveal animation, and renders the report.

Every other module is pure by design. This one absorbs all the impurity — DOM,
timers, `requestAnimationFrame`, `localStorage` construction, and `fetch` kickoff —
so that none of it leaks into the logic that needs testing.

## Interfaces

```ts
export type View = "start" | "deck" | "report" | "error";

export type ReportMode = "round" | "allTime";

/** Called once from index.html. Wires the DOM and renders the start view. */
export function main(): void;
```

`main` is the module's only export. Everything else is internal.

**`index.html` contract** — the elements `app.ts` requires, by id:

| Id | Element | Role |
|---|---|---|
| `view-start` | `<section>` | Start view root |
| `view-deck` | `<section>` | Deck view root |
| `view-report` | `<section>` | Report view root |
| `view-error` | `<section>` | Error view root |
| `start-button` | `<button>` | Begins a round |
| `card` | `<div>` | The draggable card |
| `chart-canvas` | `<canvas>` | Passed to `renderChart` |
| `card-meta` | `<div>` | Timeframe, asset class, horizon line |
| `progress` | `<div>` | "7 / 10" |
| `verdict` | `<div>` | Correct/incorrect flash after a swipe |
| `report-body` | `<div>` | Scorecard and persona output |
| `report-mode` | `<div>` | "This round" / "All time" toggle |
| `restart-button` | `<button>` | Starts another round |
| `error-message` | `<div>` | Load-failure text |

Views are switched by toggling a `hidden` attribute; only one is visible at a time.

## Data Model

Owns `View` and `ReportMode`, plus a private module-level state object holding the
current `SessionState`, the `HistoryStore`, the current view, the report mode, and
the timestamp at which the current card was shown. None of it is persisted directly
— persistence goes through `storage.ts`.

## Behaviour

### Startup

1. `main` resolves every element in the contract above. A missing element throws
   immediately with its id in the message — this is a build error and should fail
   loudly, not degrade.
2. Creates the history store and reads cumulative history.
3. Renders the start view. If history is non-empty, the start view shows the
   all-time round count and overall accuracy, which is what gives a returning user
   a reason to play again.

### Starting a round

1. On `start-button`, call `buildRound("./data", { seen: store.loadSeen() })`.
2. While it is in flight, disable the button and show a loading state.
3. On success with a non-empty deck, create the session, call `markSeen` with the
   drawn ids, switch to the deck view, and render the first card.
4. On failure, or on an empty deck, switch to the error view with a message that
   distinguishes a network failure from an empty question bank. The bank being empty
   is a build problem and the message should say so rather than blaming the network.

### Rendering a card

Set `card-meta` to a plain-language line — timeframe, asset class, and horizon, for
example `Daily · US equity · next 5 bars`. It states **how far ahead**, never which
instrument. Set `progress`. Size the canvas to its container, multiply by
`devicePixelRatio`, and call `renderChart` with `revealCount: 0`. Record the show
timestamp.

### Gesture

Pointer events on `card`, using `setPointerCapture` so a drag that leaves the card
still tracks:

- `pointerdown` records the origin and marks the card as dragging.
- `pointermove` translates the card by the horizontal delta, rotates it by
  `delta / 20` degrees capped at 15°, and tints it toward the up or down colour in
  proportion to the drag.
- `pointerup` commits when `|delta| > 25%` of the card width, **or** when the
  release velocity exceeds `0.5` px/ms — a quick flick should count even if short.
  Otherwise the card springs back with a CSS transition.

`ArrowLeft` and `ArrowRight` on `document` commit directly. Right is up, left is
down, matching the card's tint.

Input is ignored entirely while a reveal animation is running, and the session is
already guarded by `answer` throwing on a finished state, so a double-commit cannot
corrupt a round.

### Commit and reveal

1. Compute `responseMs` from the show timestamp, clamped at `0`.
2. Call `session.answer(state, given, responseMs)` and keep the new state.
3. Show the verdict in `verdict`, coloured by correctness.
4. Animate the reveal with `requestAnimationFrame`, stepping `revealCount` from `1`
   to `future.length` over roughly 600 ms, calling `renderChart` each frame.
5. Hold briefly, then either render the next card or, when `isFinished`, persist the
   round's records via `appendRecords` and switch to the report view.

Records are persisted **once at the end of the round**, not per answer — one write
instead of ten, and a quota failure then costs the whole round's history rather
than corrupting a partial one.

### Report

Renders in two blocks, matching DESIGN.md:

- **Scorecard** — `buildScorecard(records)`. Overall accuracy, then three tables.
  Every cell shows accuracy, `n`, the interval, and its verdict. A cell whose
  significance is `inconclusive` is rendered as "not enough data" with its `n`
  **visible** — never as a bare percentage, which would read as a finding.
- **Persona** — `computePersona(records)`. The label, then each metric. A `null`
  metric renders as "not enough data", never as `0`.

The `report-mode` toggle switches between the session's records and
`store.loadHistory()`, re-running both functions. All-time is the default when
history holds more than one round's worth of records, since that is the more
informative view.

### Error view

Shows `error-message` and a retry button that re-runs the round-start flow. Never a
blank screen.

## Dependencies

- All other `src/` modules
- DOM, Canvas, Pointer Events, `requestAnimationFrame`, `localStorage` (via `storage.ts`)
- No npm packages.

## Testing Notes

The Testing Agent covers this last and most lightly. It is deliberately thin — the
logic worth testing was pushed into the pure modules — and DOM-level testing without
a framework has poor cost-to-value.

Automated:

- `main` throws a message naming the missing id when a contract element is absent.
- The commit threshold helper is extracted as a pure function
  `shouldCommit(deltaX, cardWidth, velocity): Direction | null` and unit tested at
  its boundaries: just under and over 25%, the velocity path with a small delta,
  and both directions.
- The card-meta formatter is a pure function taking a `Question` and returning a
  string; test that its output contains the horizon and the asset class, and
  contains no digits that could be a year.

Manual, recorded in `summaries/app-test.md`:

- A full 10-question round on desktop with mouse drag and with arrow keys.
- A full round on a touch device, checking that vertical page scroll does not fight
  the horizontal drag.
- Reveal animation runs at each horizon: 1, 5, and 20 bars.
- Report renders correctly with an empty history, one round, and several rounds.
- The all-time toggle changes the numbers.
- The error view appears when `data/` is renamed to simulate a load failure.
- The site works served from a subpath, confirming no absolute paths leaked in.

## Open Items

None.
