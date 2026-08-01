"""Fetches intraday OHLCV from Polygon into scripts/.cache/.

Polygon is the intraday source: two years of minute bars is plenty of material,
and no free alternative offers it. Long history comes from Stooq instead.

The free tier allows 5 requests per minute, so a full run takes hours. It is
therefore rate limited and resumable — re-running skips anything already cached.

Entitlements differ per asset class and per key, so they are probed rather than
assumed. Whatever is not entitled is skipped, and the build simply has less
intraday coverage.

Standard library only. Reads POLYGON_API_KEY from the environment.

    export POLYGON_API_KEY=...
    python fetch_polygon.py [--probe-only]
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://api.polygon.io"

# 5 requests/minute with margin.
REQUEST_INTERVAL = 12.5
BACKOFF_START = 30
BACKOFF_MAX = 300
MAX_ATTEMPTS = 6

# The free tier's history limit.
HISTORY_DAYS = 730

TIMEFRAMES = {"1m": "minute", "1h": "hour"}

_last_request_at = [0.0]


def parse_aggregates(payload):
    """Converts a Polygon aggregates response to bars. Millisecond timestamps
    become seconds; rows missing any field are skipped."""
    bars = []
    for row in (payload or {}).get("results") or []:
        try:
            bars.append(
                {
                    "t": int(row["t"]) // 1000,
                    "o": float(row["o"]),
                    "h": float(row["h"]),
                    "l": float(row["l"]),
                    "c": float(row["c"]),
                    "v": float(row["v"]),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    bars.sort(key=lambda b: b["t"])
    return bars


def is_cached(path):
    """True only for a file that parses and has bars. A truncated write must be
    refetched, not silently skipped."""
    if not os.path.exists(path):
        return False
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return False
    return bool(payload.get("bars"))


def _throttle():
    elapsed = time.monotonic() - _last_request_at[0]
    if elapsed < REQUEST_INTERVAL:
        time.sleep(REQUEST_INTERVAL - elapsed)
    _last_request_at[0] = time.monotonic()


def request_json(path, params, api_key):
    """Rate limited, with exponential backoff on 429. Returns None on failure."""
    query = dict(params)
    query["apiKey"] = api_key
    url = f"{BASE}{path}?{urllib.parse.urlencode(query)}"

    backoff = BACKOFF_START
    for attempt in range(1, MAX_ATTEMPTS + 1):
        _throttle()
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                print(f"    rate limited, waiting {backoff}s (attempt {attempt})")
                time.sleep(backoff)
                backoff = min(BACKOFF_MAX, backoff * 2)
                continue
            print(f"    HTTP {exc.code} for {path}")
            return None
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            print(f"    {exc}")
            return None
    return None


def aggregates_path(ticker, span, start, end):
    return (
        f"/v2/aggs/ticker/{urllib.parse.quote(ticker)}/range/1/{span}"
        f"/{start.date().isoformat()}/{end.date().isoformat()}"
    )


def probe(universe, api_key):
    """One cheap call per asset class to see what this key can actually read."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=7)
    entitled = {}

    print(f"{'asset class':<12} {'probe ticker':<14} entitlement")
    for asset_class, sources in universe.items():
        tickers = sources.get("polygon") or []
        if not tickers:
            entitled[asset_class] = False
            print(f"{asset_class:<12} {'-':<14} no polygon symbols configured")
            continue
        payload = request_json(
            aggregates_path(tickers[0], "hour", start, end),
            {"adjusted": "true", "sort": "asc", "limit": 10},
            api_key,
        )
        allowed = bool(payload and payload.get("results"))
        entitled[asset_class] = allowed
        note = "OK" if allowed else "not entitled or no data"
        print(f"{asset_class:<12} {tickers[0]:<14} {note}")
    return entitled


def cache_path(out_dir, ticker, timeframe):
    safe = ticker.replace(":", "_").replace("/", "_")
    return os.path.join(out_dir, f"polygon__{safe}__{timeframe}.json")


def write_cache(path, payload):
    temp = path + ".tmp"
    with open(temp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(temp, path)


def main(argv=None):
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="Fetch intraday bars from Polygon.")
    parser.add_argument("--universe", default=os.path.join(here, "universe.json"))
    parser.add_argument("--out", default=os.path.join(here, ".cache"))
    parser.add_argument("--probe-only", action="store_true")
    args = parser.parse_args(argv)

    api_key = os.environ.get("POLYGON_API_KEY")
    if not api_key:
        print(
            "POLYGON_API_KEY is not set. Intraday coverage will be skipped; "
            "daily and monthly questions still build from Stooq.",
            file=sys.stderr,
        )
        return 2

    with open(args.universe, "r", encoding="utf-8") as fh:
        universe = json.load(fh)
    os.makedirs(args.out, exist_ok=True)

    entitled = probe(universe, api_key)
    if args.probe_only:
        return 0

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=HISTORY_DAYS)

    print()
    fetched = 0
    for asset_class, sources in universe.items():
        if not entitled.get(asset_class):
            continue
        for ticker in sources.get("polygon", []):
            for timeframe, span in TIMEFRAMES.items():
                path = cache_path(args.out, ticker, timeframe)
                if is_cached(path):
                    print(f"{ticker:<12} {timeframe:<4} cached")
                    fetched += 1
                    continue

                payload = request_json(
                    aggregates_path(ticker, span, start, end),
                    {"adjusted": "true", "sort": "asc", "limit": 50000},
                    api_key,
                )
                bars = parse_aggregates(payload)
                if not bars:
                    print(f"{ticker:<12} {timeframe:<4} no data")
                    continue

                write_cache(
                    path,
                    {
                        "source": "polygon",
                        "symbol": ticker,
                        "assetClass": asset_class,
                        "timeframe": timeframe,
                        "bars": bars,
                    },
                )
                fetched += 1
                print(f"{ticker:<12} {timeframe:<4} {len(bars)} bars")

    print(f"\n{fetched} series cached in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
