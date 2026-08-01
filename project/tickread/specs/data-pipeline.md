# Data Pipeline

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Builds the question bank that the app ships with. Fetches raw OHLCV bars from Stooq
and Polygon, slices them into balanced anonymised questions, and writes
`code/data/manifest.json` plus one shard file per timeframe.

This runs on the developer's machine, never in CI and never in the browser. Its
output is committed to the repo; the app has no other data source.

Covers three scripts and their shared universe file:
`scripts/fetch_stooq.py`, `scripts/fetch_polygon.py`, `scripts/build_deck.py`,
`scripts/universe.json`.

## Interfaces

**Command line**

```
python scripts/fetch_stooq.py    [--universe scripts/universe.json] [--out scripts/.cache]
python scripts/fetch_polygon.py  [--universe scripts/universe.json] [--out scripts/.cache] [--probe-only]
python scripts/build_deck.py     [--cache scripts/.cache] [--out data] [--target 1500] [--seed 0]
```

`fetch_polygon.py` reads the API key from the `POLYGON_API_KEY` environment
variable. If unset it prints an error and exits `2` without making any request.

**Cache contract** — the fetchers' only output, and `build_deck.py`'s only input:

```
scripts/.cache/<source>__<symbol>__<timeframe>.json
```

```json
{
  "source": "stooq" | "polygon",
  "symbol": "aapl.us",
  "assetClass": "equity",
  "timeframe": "1m" | "1h" | "1d",
  "bars": [{ "t": 1717171200, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1000 }]
}
```

`t` is epoch seconds UTC, bars ascending, no duplicates. Monthly is never cached —
it is derived from `1d` inside `build_deck.py`.

**`scripts/universe.json`**

```json
{
  "equity":    { "stooq": ["aapl.us", "..."], "polygon": ["AAPL", "..."] },
  "etf_index": { "stooq": ["spy.us", "..."],  "polygon": ["SPY", "..."] },
  "future":    { "stooq": ["cl.f", "..."],    "polygon": [] },
  "crypto":    { "stooq": ["btcusd", "..."],  "polygon": ["X:BTCUSD"] }
}
```

**Shipped output** — `data/manifest.json` and `data/questions-<timeframe>.json`.
Shard files are a bare `Question[]`.

## Data Model

These are the core types. `build_deck.py` writes them; `src/types.ts` declares them
and every other component consumes them. This component **owns** them — no other
spec may redefine them.

```ts
export type AssetClass = "equity" | "etf_index" | "future" | "crypto";
export type Timeframe  = "1m" | "1h" | "1d" | "1mo";
export type Horizon    = 1 | 5 | 20;
export type Direction  = "up" | "down";

/** A shipped bar. Deliberately carries no timestamp — see Behaviour § Anonymisation. */
export interface Bar { o: number; h: number; l: number; c: number; v: number }

export interface Question {
  id: string;            // 12 lowercase hex chars, opaque
  assetClass: AssetClass;
  timeframe: Timeframe;
  horizon: Horizon;
  setup: Bar[];          // exactly 60
  future: Bar[];         // exactly `horizon`
  answer: Direction;
}

export interface ShardInfo {
  timeframe: Timeframe;
  file: string;          // relative to data/, e.g. "questions-1d.json"
  count: number;
  assetClasses: AssetClass[];
  horizons: Horizon[];
}

export interface Manifest {
  version: 1;
  generatedAt: string;   // ISO 8601, build time — not market data
  setupLength: 60;
  shards: ShardInfo[];
}
```

The build script's internal bar type additionally carries `t`; `t` is stripped when
writing shards.

## Behaviour

### `fetch_stooq.py` — happy path

1. Read `universe.json`, collect every `stooq` symbol with its asset class.
2. For each, `GET https://stooq.com/q/d/l/?s=<symbol>&i=d` with a browser
   `User-Agent` header. Response is CSV `Date,Open,High,Low,Close,Volume`.
3. Parse to bars, sort ascending, drop rows with any non-numeric field.
4. Write `stooq__<symbol>__1d.json`.
5. Print a coverage table: symbol, bar count, first and last date, and whether
   volume is usable.

### `fetch_polygon.py` — happy path

1. Fail fast if `POLYGON_API_KEY` is unset.
2. **Probe entitlements first.** One cheap aggregates call per asset class that has
   Polygon symbols. Record which asset classes return `200` with data. Print the
   result as a coverage table and skip non-entitled classes entirely. `--probe-only`
   stops here.
3. For each entitled symbol and each of `1m`, `1h`: request
   `/v2/aggs/ticker/<ticker>/range/1/<minute|hour>/<from>/<to>?adjusted=true&sort=asc&limit=50000`,
   paging by `from` until the window is covered or no bars are returned.
   `<to>` is today; `<from>` is two years ago.
4. Write one cache file per symbol and timeframe.

### `fetch_polygon.py` — rate limiting and resume

- Sleep at least **12.5 seconds between requests** (5/min with margin).
- On HTTP `429`, back off exponentially starting at 30 s, doubling, capped at
  5 minutes, up to 6 attempts, then skip that symbol and record it as failed.
- **Before any request, check whether the target cache file already exists and is
  valid JSON — if so, skip it.** A full build is hours long and must survive being
  interrupted and re-run. Cache files are written atomically (temp file, then
  rename) so an interrupted write never leaves a half-file that gets skipped.

### `build_deck.py` — happy path

1. Load every cache file. Reject any file whose bars are fewer than
   `60 + 20 + 30` — too short to yield even one question.
2. Derive `1mo` series from each `1d` series: group by calendar month, `o` = first
   open, `h` = max high, `l` = min low, `c` = last close, `v` = sum of volume.
   **Discard the trailing month**, which is partial.
3. For each series and each horizon in `{1, 5, 20}`, slide a window over the bars.
   Window `i` uses `bars[i .. i+59]` as setup and `bars[i+60 .. i+59+horizon]` as
   future. Advance `i` by at least **30** bars between accepted windows from the
   same series, so the bank does not fill with near-duplicate charts.
4. Compute `answer` from `sign(future[-1].c - setup[-1].c)`.
5. Apply the rejection rules below.
6. **Balance**: within every `(assetClass, timeframe, horizon)` bucket, take the
   same number of `up` and `down` candidates — `min(count_up, count_down)`, capped
   so the total lands near `--target`. Selection within a bucket is a seeded shuffle
   so builds are reproducible.
7. Round prices to 4 significant figures and volumes to integers. Strip `t`.
8. Compute `id` as the first 12 hex chars of
   `sha256(source + symbol + timeframe + horizon + window_start_epoch)`. Opaque and
   stable across rebuilds.
9. Write one shard per timeframe and a manifest describing what was actually built.

### `build_deck.py` — rejection rules

A candidate window is discarded if any of these hold. Each rule exists for a stated
reason; none may be dropped without raising it with the human.

| Rule | Reason |
|---|---|
| `abs(future[-1].c / setup[-1].c - 1) < 0.0005` | A coin flip dressed as a question |
| Any bar in setup or future has `v <= 0`, or volume is missing | The volume panel is core to the question; Stooq returns zero volume for some futures and crypto symbols |
| Any bar has `h < l`, or `c`/`o` outside `[l, h]`, or any non-positive price | Corrupt source data |
| The window spans a gap of more than 5× the series' median bar interval | A hidden halt or listing gap would render as a misleading flat stretch |

### Anonymisation

Three things must not reach the shipped files. The Code Review Agent verifies each.

- **No ticker.** `Question` has no symbol field, and `id` is a hash.
- **No dates.** `Bar` has no `t`. The X axis is bar index only.
- **No absolute price.** Prices *are* shipped as-is, but `chart.ts` renders the Y
  axis as percentage relative to the last setup close and never draws an absolute
  value. Shipping raw prices is acceptable because the rendered output reveals none.

### Error handling

- A single symbol failing (404, empty CSV, malformed JSON, exhausted retries) is
  logged and skipped. The build continues.
- `build_deck.py` exits `1` if it produced **zero** questions for any timeframe that
  has cached input, or if the final bank is under 200 questions — silently shipping
  an unusably thin bank is worse than failing.
- Every script ends with a summary table: per asset class and timeframe, the number
  of questions produced and the reason counts for rejected windows.

## Dependencies

- Python 3.12 standard library only: `urllib.request`, `csv`, `json`, `hashlib`,
  `argparse`, `datetime`, `statistics`, `random`, `time`, `os`, `unittest`.
  **No `requests`, no `yfinance`, no `pandas`.**
- Network access to `stooq.com` and `api.polygon.io`.
- `POLYGON_API_KEY` in the environment, for `fetch_polygon.py` only.

## Testing Notes

Critical paths, all with fabricated in-memory bars — **no test may hit the network**:

- Monthly aggregation: correct O/H/L/C/V per month; trailing partial month dropped;
  a month with a single trading day still aggregates.
- Window slicing: setup length is exactly 60, future length exactly `horizon`,
  accepted windows from one series are at least 30 bars apart, and the last possible
  window is not off-by-one.
- Answer derivation and the tie rule at the boundary: returns of exactly
  ±0.0005 and just inside it.
- Zero-volume rejection: a window with one `v == 0` bar anywhere in setup or future.
- Balance: every `(assetClass, timeframe, horizon)` bucket in the output has equal
  `up` and `down` counts.
- `id` stability: the same input produces the same id across two runs; different
  windows never collide within one build.
- Shipped `Bar` objects have exactly the keys `o h l c v` — this is the regression
  test for the no-dates rule.
- Resume: given an existing valid cache file, the fetcher makes no request;
  given a truncated one, it refetches.

CSV and JSON parsing are tested against captured sample payloads stored under
`scripts/testdata/`, not by calling the live endpoints.

## Open Items

- Which asset classes the available Polygon key is entitled to. Resolved by the
  probe at step 2; affects intraday coverage only, and the manifest records the
  outcome so the UI adapts. Raised in DESIGN.md § Open Items.
- Stooq's exact symbol strings for futures need validating on first run. The
  coverage table makes failures visible; unavailable symbols are dropped from
  `universe.json`. Raised in DESIGN.md § Open Items.
