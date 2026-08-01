"""Fetches OHLCV bars from Yahoo Finance into scripts/.cache/.

This is the primary source and needs no API key. It covers all four timeframes:

    1m   7 days of history   (Yahoo's limit for minute bars)
    1h   730 days
    1d   10 years            (monthly is aggregated from this in build_deck.py)

Seven days of minute bars is ample — one liquid symbol yields thousands of bars and
therefore dozens of non-overlapping windows per horizon.

Stooq was the original daily source but now gates the endpoint behind a JavaScript
proof-of-work browser check, which this pipeline does not attempt to defeat.
fetch_polygon.py remains as an optional supplement for deeper minute history.

Standard library only.

    python fetch_yahoo.py [--universe universe.json] [--out .cache]
"""

import argparse
import http.client
import json
import os
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    "?interval={interval}&period1={start}&period2={end}"
)

# Yahoo rejects requests without a browser-like agent.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# timeframe -> (yahoo interval, how many days back; None means all available)
#
# An explicit period window rather than Yahoo's `range` parameter. `range=max`
# makes Yahoo silently return a coarser series than the interval asked for, which
# is the corruption granularity_ok() below exists to catch.
TIMEFRAMES = {
    "1m": ("1m", 7),
    "1h": ("1h", 730),
    "1d": ("1d", None),
}

# Nominal seconds between bars, used only to sanity check what came back.
EXPECTED_GAP = {"1m": 60, "1h": 3600, "1d": 86400}

# How far the observed median may drift from the nominal spacing. Generous on the
# low side because sessions are ragged, tight on the high side because that is the
# direction the corruption goes.
GAP_TOLERANCE_LOW = 0.5
GAP_TOLERANCE_HIGH = 1.5

REQUEST_PAUSE = 1.0


def parse_chart(payload):
    """Converts Yahoo's parallel arrays into bars.

    Yahoo pads its arrays with nulls for sessions that produced no bar, so any
    index with a missing field is skipped rather than defaulted — a bar invented
    from a null would render as a flat candle that never traded.
    """
    chart = (payload or {}).get("chart") or {}
    if chart.get("error"):
        return []
    results = chart.get("result") or []
    if not results:
        return []

    result = results[0]
    timestamps = result.get("timestamp") or []
    quotes = (result.get("indicators") or {}).get("quote") or [{}]
    quote = quotes[0] if quotes else {}

    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    bars = []
    for i, t in enumerate(timestamps):
        try:
            o, h, l, c, v = opens[i], highs[i], lows[i], closes[i], volumes[i]
        except IndexError:
            continue
        if t is None or None in (o, h, l, c, v):
            continue
        try:
            bars.append(
                {
                    "t": int(t),
                    "o": float(o),
                    "h": float(h),
                    "l": float(l),
                    "c": float(c),
                    "v": float(v),
                }
            )
        except (TypeError, ValueError):
            continue

    bars.sort(key=lambda b: b["t"])
    return bars


def granularity_ok(bars, timeframe):
    """Whether the bars actually have the spacing that was requested.

    Yahoo will happily answer a request for daily bars with monthly ones and label
    the response the same either way. Cached under the requested timeframe, those
    bars would flow into the bank as a chart the user is told is daily, and the
    monthly aggregation downstream would compound the error. So the spacing is
    measured rather than assumed.

    Uses the median gap, which weekends and overnight closes leave untouched.
    Unknown timeframes and series too short to measure pass, since there is nothing
    to check against.
    """
    expected = EXPECTED_GAP.get(timeframe)
    if expected is None or len(bars) < 3:
        return True
    gaps = [b["t"] - a["t"] for a, b in zip(bars, bars[1:]) if b["t"] > a["t"]]
    if not gaps:
        return True
    observed = statistics.median(gaps)
    return expected * GAP_TOLERANCE_LOW <= observed <= expected * GAP_TOLERANCE_HIGH


def fetch(symbol, interval, days_back, attempts=3):
    """Full-history responses run to several megabytes over chunked encoding, which
    intermittently truncates. A truncated read is retried rather than treated as a
    missing symbol, since the difference matters: one is transient, the other means
    the universe file needs fixing."""
    end = int(datetime.now(timezone.utc).timestamp())
    start = 0 if days_back is None else end - days_back * 86400
    url = URL.format(
        symbol=urllib.parse.quote(symbol), interval=interval, start=start, end=end
    )
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    last_error = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read().decode("utf-8"))
        except (http.client.HTTPException, ConnectionError) as exc:
            last_error = exc
            time.sleep(2 * (attempt + 1))
    raise last_error


def cache_path(out_dir, symbol, timeframe):
    safe = symbol.replace("/", "_").replace(":", "_").replace("=", "-")
    return os.path.join(out_dir, f"yahoo__{safe}__{timeframe}.json")


def write_cache(path, payload):
    """Temp file then rename, so an interrupted run never leaves a half-file that a
    later run would mistake for complete."""
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(temp, path)


def main(argv=None):
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="Fetch OHLCV bars from Yahoo Finance.")
    parser.add_argument("--universe", default=os.path.join(here, "universe.json"))
    parser.add_argument("--out", default=os.path.join(here, ".cache"))
    args = parser.parse_args(argv)

    with open(args.universe, "r", encoding="utf-8") as fh:
        universe = json.load(fh)
    os.makedirs(args.out, exist_ok=True)

    print(f"{'symbol':<10} {'class':<10} {'tf':<4} {'bars':>7} {'volume':>7}  span")
    cached = 0
    failed = []

    for asset_class, sources in universe.items():
        for symbol in sources.get("yahoo", []):
            for timeframe, (interval, days_back) in TIMEFRAMES.items():
                path = cache_path(args.out, symbol, timeframe)
                if os.path.exists(path):
                    print(f"{symbol:<10} {asset_class:<10} {timeframe:<4} {'cached':>7}")
                    cached += 1
                    continue

                try:
                    bars = parse_chart(fetch(symbol, interval, days_back))
                except (
                    urllib.error.URLError,
                    http.client.HTTPException,
                    ConnectionError,
                    TimeoutError,
                    ValueError,
                ) as exc:
                    print(f"{symbol:<10} {asset_class:<10} {timeframe:<4} {'FAILED':>7}  {exc}")
                    failed.append(f"{symbol}/{timeframe}")
                    continue

                if not bars:
                    print(f"{symbol:<10} {asset_class:<10} {timeframe:<4} {'EMPTY':>7}")
                    failed.append(f"{symbol}/{timeframe}")
                    continue

                if not granularity_ok(bars, timeframe):
                    gaps = [b["t"] - a["t"] for a, b in zip(bars, bars[1:]) if b["t"] > a["t"]]
                    observed = statistics.median(gaps) / 86400 if gaps else 0
                    print(
                        f"{symbol:<10} {asset_class:<10} {timeframe:<4} {'WRONG':>7}  "
                        f"got {observed:.1f}d spacing, not caching"
                    )
                    failed.append(f"{symbol}/{timeframe} (wrong granularity)")
                    continue

                write_cache(
                    path,
                    {
                        "source": "yahoo",
                        "symbol": symbol,
                        "assetClass": asset_class,
                        "timeframe": timeframe,
                        "bars": bars,
                    },
                )
                cached += 1
                with_volume = sum(1 for b in bars if b["v"] > 0)
                first = datetime.fromtimestamp(bars[0]["t"], tz=timezone.utc).date()
                last = datetime.fromtimestamp(bars[-1]["t"], tz=timezone.utc).date()
                print(
                    f"{symbol:<10} {asset_class:<10} {timeframe:<4} {len(bars):>7} "
                    f"{with_volume:>7}  {first} .. {last}"
                )
                time.sleep(REQUEST_PAUSE)

    print(f"\n{cached} series cached in {args.out}")
    if failed:
        print(f"{len(failed)} failed: {', '.join(failed)}")
    return 0 if cached else 1


if __name__ == "__main__":
    raise SystemExit(main())
