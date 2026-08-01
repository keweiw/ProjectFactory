# tickread — Design Document

**Status:** DESIGN_DRAFT
**Author:** Ying Liu
**Date:** 2026-08-01

---

## Vision

**tickread** is a swipe-based market intuition test. The user is shown an anonymised
candlestick + volume chart and swipes **right for up**, **left for down**. After 20
questions the app produces a report covering two things:

1. **Scorecard** — where the user is actually good, broken down by asset class,
   timeframe, and prediction horizon.
2. **Behavioural profile** — how the user decides, independent of whether they were
   right: bull bias, momentum vs. mean-reversion tendency, volume sensitivity,
   decision speed, consistency.

The name comes from the trading term *reading the tape*.

The app is a **static site**. All market data is fetched offline at build time and
shipped as JSON. At runtime there are no API calls, no keys, no backend, and no
hosting cost.

### Non-goals

- Real-time or live market data
- User accounts, leaderboards, social features
- Options questions (no free source of historical option OHLCV bars — dropped)
- Any suggestion that this is trading advice

---

## Question Universe

| Dimension | Values |
|---|---|
| Asset class | `equity`, `etf_index`, `future`, `crypto` |
| Timeframe | `1m`, `1h`, `1d`, `1mo` |
| Horizon | `1`, `5`, `20` bars ahead |

Each question shows **60 setup bars** and asks the direction of the close
`horizon` bars later, relative to the last setup close.

Actual coverage of the asset-class × timeframe grid is **not hardcoded**. The build
script probes what each data source actually returns and records the result in
`data/manifest.json`. The UI reads the manifest and only offers buckets that exist,
so a missing data entitlement degrades coverage instead of breaking the app.

---

## Data Pipeline (offline, build time)

| Timeframe | Source | Notes |
|---|---|---|
| `1m` | Yahoo | 7 days — thousands of bars per symbol, plenty of windows |
| `1h` | Yahoo | 730 days |
| `1d` | Yahoo | Full history: 45 years for AAPL, 26 for the futures |
| `1mo` | Yahoo | **Aggregated locally from daily bars**, not fetched separately |

Yahoo Finance's chart endpoint covers every timeframe and every asset class with no
API key, so it is the primary and only required source.

Stooq was the original choice for daily history but now gates the endpoint behind a
JavaScript proof-of-work browser check. This pipeline does not attempt to defeat it.

**Polygon is optional.** With `POLYGON_API_KEY` set, `fetch_polygon.py` adds two
years of minute bars instead of Yahoo's seven days. Without it the build is
complete and nothing is missing; coverage is simply shallower on `1m`.

Scripts use the **Python standard library only** (`urllib`, `json`, `hashlib`). No
`requests`, no `yfinance`, no pip installs.

### Trusting nothing about what comes back

Two failures found by running the pipeline, both silent, now have guards:

- **Yahoo answers the wrong granularity.** Requesting `interval=1d&range=max`
  returns *monthly or quarterly* bars — AAPL came back with a 91-day median gap —
  labelled identically to the daily series that was asked for. Cached as `1d`, those
  bars would have flowed into the bank as charts the user is told are daily, and the
  monthly aggregation would have compounded the error. The fetcher now requests an
  explicit `period1`/`period2` window and **measures the median gap of what it got**,
  refusing to cache anything whose spacing does not match the timeframe requested.
- **Full-history responses truncate.** Multi-megabyte chunked responses
  intermittently raise `IncompleteRead`. That is now retried, because a transient
  truncation and a genuinely missing symbol call for different responses.

### Polygon constraints (only when a key is configured)

- **5 requests/minute.** The fetcher sleeps between calls and backs off on HTTP 429.
- **Resumable.** Each response is cached to `scripts/.cache/<key>.json`; a re-run
  skips anything already cached. A full build is roughly two hours of wall time and
  can be interrupted freely.
- **Entitlements are probed, not assumed.** The free Stocks tier covers stocks and
  ETFs. Futures, indices, and crypto sit on separate plans. At startup the script
  makes one probe call per asset class and prints a coverage table. Whatever is not
  entitled simply falls back to Stooq daily/monthly coverage for that asset class.
- **The API key is read from the `POLYGON_API_KEY` environment variable.** It is
  never written to disk, never committed, and never reaches the browser.

### Volume

Yahoo returns **zero volume** for a large share of crypto and futures intraday
bars — only 2,658 of BTC-USD's 10,015 minute bars carry any. Since the volume panel
is half the question, any window containing a zero-volume bar is rejected at build
time. The visible consequence is that crypto has no `1m` or `1h` questions, which
the manifest records and the UI respects.

### Monthly aggregation

Daily bars are grouped by calendar month: `open` = first open, `high` = max,
`low` = min, `close` = last close, `volume` = sum. Partial trailing months are
discarded.

---

## Question Bank

```ts
interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

interface Question {
  id: string;              // stable hash of source + timeframe + window start
  assetClass: AssetClass;
  timeframe: Timeframe;
  horizon: Horizon;        // 1 | 5 | 20
  setup: Bar[];            // exactly 60
  future: Bar[];           // exactly `horizon` bars — used for the reveal
  answer: "up" | "down";
}
```

`answer` is `sign(future[horizon-1].c - setup[59].c)`.

`future` holds exactly `horizon` bars, not a fixed 20. Revealing 20 bars on a
1-bar question would both confuse the user and bloat the payload.

### Generation rules

Three rules make the test meaningful. All are enforced in `build_deck.py` and
covered by tests.

1. **Answer balance.** Within every `(assetClass, timeframe, horizon)` bucket,
   up and down answers are sampled to exactly 50/50. Without this, swiping right
   on everything wins and the whole report is noise.
2. **Anonymisation.** No ticker, no dates. The Y axis shows **percentage change
   relative to the last setup close**, never absolute price — seeing "$60,000"
   identifies Bitcoin, and seeing a March-2020 date identifies the crash.
   The X axis shows bar index only.
3. **Tie exclusion.** Windows where `|return| < 0.05%` are discarded. A coin-flip
   dressed as a question teaches nothing.

Additional sampling rule: consecutive windows from the same series must be at
least **30 bars apart**, so the bank does not fill with near-duplicate charts.

### Payload

The built bank holds **1,340 questions**: 342 at `1m`, 228 at `1h`, 456 at `1d`,
314 at `1mo`. Prices are rounded to 4 significant figures and volumes to integers.
Sharded by timeframe into four files — 5.0 MB raw, **1.24 MB gzipped**, measured.

All shards are loaded at the start of a round, in parallel. Loading only the shards
a round draws from would be smaller, but stratified sampling needs the full pool up
front to guarantee that thin strata are represented — and at ~1 MB gzipped the
saving does not pay for the constraint. Sharding remains useful for cache
granularity and for keeping the files reviewable.

---

## Runtime Architecture

No framework, no bundler, no npm runtime dependencies. TypeScript compiles with
`tsc` to native ES modules that the browser loads directly via
`<script type="module">`.

**Local development requires a static server** (`python -m http.server 8000`).
Browsers block ES module loading and `fetch` over `file://`. On GitHub Pages the
site is served over HTTP, so this only affects local work. All asset paths are
relative so the site works under any base path.

### Modules

| File | Responsibility | Depends on |
|---|---|---|
| `src/types.ts` | Shared types. No logic. | — |
| `src/deck.ts` | Load shards from the manifest; stratified draw of 20 questions; avoid recently seen ones | `types` |
| `src/chart.ts` | Pure canvas renderer: `(ctx, bars, opts) => void`. Candles + volume panel + reveal state | `types` |
| `src/session.ts` | One round's state machine: current index, record answer + response time, advance | `types`, `persona` |
| `src/stats.ts` | Wilson intervals, bucketed accuracy, significance test | `types` |
| `src/persona.ts` | Behavioural metrics and label derivation | `types` |
| `src/storage.ts` | `localStorage` persistence of cumulative history and seen-question ids | `types` |
| `src/app.ts` | Entry point: view switching, pointer/keyboard gestures, DOM assembly | all |

**Every interface shared between modules is declared in `src/types.ts`**, even when
another module is the authority on its meaning — `AnswerRecord` and
`QuestionFeatures` included. Declaring them where they are conceptually owned would
make `session` and `persona` import each other, and a module cycle held together
only by type erasure is a trap for the next person. `types.ts` stays logic-free;
each component spec remains authoritative for the shape of the types it defines.

`deck`, `session`, `stats`, and `persona` are **pure and DOM-free**. They hold all
the real logic risk — interval maths, metric edge cases, stratified sampling — and
are therefore the modules that get unit tested. `chart.ts` is pure too but is
verified only for "renders without throwing at the right dimensions"; pixel
comparison is not worth the cost.

### Views

Three views, switched by a single function in `app.ts`:

1. **Start** — brief explanation, cumulative stats if any history exists, start button.
2. **Deck** — the card. Header line states timeframe, asset class, and horizon in
   plain language ("Daily · US equity · next 5 bars"). It tells the user *how far
   ahead*, never *which instrument*.
3. **Report** — scorecard and behavioural profile.

### Interaction

Swipe left/right by pointer drag, or press `←` / `→`. The card follows the drag
with rotation and a colour tint, and commits past a threshold.

On commit the app **reveals immediately**: the `horizon` future bars animate in,
correct/incorrect is coloured, and the response time is recorded. This feedback
loop is the core of the experience — holding all results until the end would kill it.

---

## Report

### Scorecard

Overall accuracy, plus accuracy split three ways: by asset class, by timeframe, by
horizon.

Each cell shows its **sample size** and a **Wilson 95% confidence interval**. A cell
is labelled a significant strength or weakness only when **n ≥ 8 and the interval
excludes 50%**. Otherwise it is labelled "not enough data".

This constraint is deliberate and non-negotiable. Twenty questions split three ways
is inherently sparse; without it the report would be presenting noise as insight.

The compensation is **cumulative history**. Every answer is persisted to
`localStorage`, and the report toggles between "this round" and "all time". Cells
become significant after a few rounds — which also gives the app a reason to come
back to.

### Behavioural profile

None of these depend on being right, so they are meaningful from the first round.

| Metric | Definition |
|---|---|
| `bullBias` | share of right swipes, ∈ [0, 1] |
| `momentumScore` | `P(right \| tail trend up) − P(right \| tail trend down)`, ∈ [−1, 1]. Tail trend = `sign(setup[59].c − setup[49].c)`; questions where that difference is exactly 0 are excluded from both groups |
| `volumeSensitivity` | `P(right \| volume surge) − P(right \| no surge)`. Surge = mean volume of last 5 bars > 1.5× mean of all 60 |
| `volatilitySensitivity` | `P(right \| high vol) − P(right \| low vol)`, split at the median realised volatility of answered questions |
| `decisionSpeed` | median response time, ms |
| `consistency` | questions binned by (tail trend sign × volatility tercile); within each bin of n ≥ 3, the share taken by the majority answer; averaged. ∈ [0.5, 1] |

Realised volatility, and the median and terciles derived from it, are always
computed **over the set of questions being reported on** — the current round in
"this round" mode, the whole persisted history in "all time" mode. Any metric whose
denominator is zero is reported as unavailable rather than defaulting to 0.

Label derived from two axes:

| | bull ≥ 0.60 | 0.40 < bull < 0.60 | bull ≤ 0.40 |
|---|---|---|---|
| **momentum ≥ +0.15** | Trend Surfer | Momentum Hunter | Breakdown Chaser |
| **between** | Optimistic Drifter | Coin Flipper | Pessimistic Drifter |
| **momentum ≤ −0.15** | Dip Buyer | Mean Reverter | Top Seller |

---

## Persistence

| Key | Contents |
|---|---|
| `tickread.history.v1` | Array of `{ questionId, assetClass, timeframe, horizon, given, correct, responseMs, ts }`, capped at 2000 records, oldest dropped first |
| `tickread.seen.v1` | Question ids already served, so the deck prefers unseen questions until the bank is exhausted |

Both are read defensively: a malformed or absent value resets to empty rather than
throwing. A version suffix in the key allows a clean break if the shape changes.

---

## Testing

No npm, so no Vitest. A hand-rolled assertion harness (~40 lines) is compiled
alongside the app and driven by two entry points sharing one set of test modules:

- `tests/index.html` — runs in the browser, satisfying the framework's
  "no build server" testing requirement
- `node dist/tests/run.js` — runs from the command line for automation

Coverage focuses on the pure modules:

- `stats` — Wilson interval against known values; boundary behaviour at n = 0, 1, 8;
  the significance rule on intervals that straddle, touch, and clear 50%
- `persona` — every metric at its edges (all-right swipes, no volume surges, fewer
  than 3 items in a consistency bin), and each of the nine label boundaries
- `deck` — stratified draw covers requested strata; never repeats within a round;
  degrades correctly when the bank is smaller than requested
- `session` — records answers and timings in order; cannot advance past the end
- `chart` — renders without throwing across timeframes and both reveal states

`build_deck.py` is tested with `unittest` (stdlib) for window slicing, monthly
aggregation, answer balance, tie exclusion, and zero-volume rejection.

---

## Deployment

GitHub Pages, published by a GitHub Actions workflow on push. The workflow installs
`typescript` globally, runs `tsc`, and publishes `project/tickread/code` as the site.
Compiled output is therefore not committed.

The question bank **is** committed — it is the app's data, it is static, and it is
what makes the runtime dependency-free.

Nothing else is required: no server, no secrets in CI, no running cost. The Polygon
key is used only on the developer's machine when rebuilding the bank.

---

## Repository Layout

```
project/tickread/
  AGENTS.md            ← project-specific agent rules
  DESIGN.md            ← this file
  specs/               ← component specs (Architect Agent)
  summaries/           ← implementation summaries (Coding Agent)
  code/
    index.html
    style.css
    tsconfig.json
    README.md          ← how to build, run locally, rebuild the bank
    src/               ← the eight modules above
    data/              ← manifest.json + four question shards
    scripts/           ← fetch_stooq.py, fetch_polygon.py, build_deck.py, universe.json
    tests/
```

---

## Open Items

- [ ] Which asset classes the available Polygon key is entitled to for intraday.
      Resolved at build time by the probe; affects intraday coverage only.
- [ ] Stooq symbol coverage for futures. The universe list needs validating against
      the live endpoint during the first build; unavailable symbols get dropped.
