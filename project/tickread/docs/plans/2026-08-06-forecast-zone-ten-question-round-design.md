# Forecast Zone, Ten-Question Rounds, and Sample Finder Design

**Date:** 2026-08-06
**Status:** Approved

## Purpose

Make the prediction horizon visible on the candlestick chart itself, shorten each
round from twenty questions to ten, and provide a reusable project skill for
finding candidate question samples from Yahoo market data.

## Forecast Zone

The chart will reserve a visually distinct forecast zone immediately after the
last setup candle. The zone uses a low-contrast neutral fill, a dashed boundary at
the setup/future transition, and a compact `NEXT 1 BAR`, `NEXT 5 BARS`, or
`NEXT 20 BARS` label.

The zone normally follows the true setup-to-horizon proportion. A one-bar horizon
would otherwise be nearly invisible, so it receives a small minimum visible width.
Future candles remain narrow and are positioned within that zone; the extra width
is presentation space, not an implied longer horizon.

Before an answer, the forecast zone is empty and neutral. After an answer, future
candles animate into the same fixed geometry. The chart does not reflow between
hidden and revealed states, and the zone never uses up/down colours that could hint
at the answer.

The implementation remains inside `chart.ts`. `app.ts` continues to pass setup,
future, and reveal state through the existing renderer interface. Theme fields are
extended for light/dark forecast fill, border, and label colours.

## Ten-Question Rounds

`DEFAULT_DECK_SIZE` changes from twenty to ten. Round selection remains stratified
across timeframe/horizon buckets, but a ten-question round cannot cover all twelve
buckets and is not required to do so.

Per-round answer-balance repair is removed. The offline question bank retains its
bucket-level 50/50 generation rule, but a live round is allowed to contain the
natural up/down mix produced by sampling.

All user-visible copy, progress expectations, historical round estimates, tests,
and integration checks change to ten questions. The statistical significance rule
stays unchanged: a bucket needs at least eight answers and a Wilson interval that
excludes 50 percent. All-time history therefore remains the primary source of
strong conclusions.

## Yahoo Sample Finder Skill

A project-local `tickread-sample-finder` skill will find suitable candlestick
windows from Yahoo data without mutating the committed question bank.

The skill accepts filters such as symbol, asset class, timeframe, horizon, count,
and random seed. It reads `code/scripts/.cache/` by default and only refreshes data
from Yahoo when explicitly requested. Candidate selection reuses tickread's core
eligibility rules:

- exactly 60 setup bars and the requested future horizon;
- absolute future return of at least 0.05 percent;
- no zero-volume bars in the complete window;
- adequate spacing between windows from the same series;
- no per-result up/down balancing.

Generated artifacts are temporary and ignored by Git. The primary output is an
HTML gallery rendered with the production canvas renderer. Each card initially
shows only the anonymous setup and forecast zone; a reveal control shows the future
candles and the source metadata needed for review. A compact JSON file accompanies
the gallery so selected samples can be promoted into fixtures later.

The finder will reuse or call project scripts rather than duplicating question
eligibility formulas in skill prose. It must not write to `code/data/`.

## Error Handling

- A missing cache produces a clear instruction to fetch Yahoo data or request a
  refresh; it does not silently rebuild the production bank.
- Unsupported symbols, timeframes, or horizons fail with an actionable message.
- An insufficient candidate pool returns the available samples and reports the
  shortfall.
- Forecast-zone rendering remains a no-op for empty setup data or non-positive
  canvas dimensions, matching the existing renderer behaviour.

## Testing

- Chart unit tests verify zone geometry, monotonic horizon widths, the one-bar
  minimum, label text, and unchanged geometry between hidden and revealed states.
- Existing chart tests continue to verify that future candles are not drawn before
  reveal.
- Deck tests verify a default size of ten and confirm that per-round balancing is
  no longer applied.
- App and integration tests complete exactly ten answers against the shipped bank.
- Sample-finder tests use temporary synthetic Yahoo cache files, make no network
  calls, verify filtering and deterministic selection, and assert that production
  `data/` is untouched.
- Final verification runs strict TypeScript compilation, the Node test harness,
  Python `unittest`, the HTTP integration test, and a browser-visible gallery smoke
  check.
