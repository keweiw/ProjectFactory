"""Turns cached OHLCV bars into the shipped question bank.

Standard library only. Reads scripts/.cache/*.json, writes data/manifest.json and
data/questions-<timeframe>.json.

    python build_deck.py [--cache .cache] [--out ../data] [--target 1500] [--seed 0]

See specs/data-pipeline.md.
"""

import argparse
import hashlib
import json
import math
import os
import random
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone

SETUP_LENGTH = 60
HORIZONS = (1, 5, 20)

# Consecutive windows from one series must be at least this far apart, so the bank
# does not fill with near-duplicate charts.
STRIDE = 30

# Below this move the question is a coin flip dressed up as a question.
TIE_THRESHOLD = 0.0005

# A jump longer than this multiple of the series' 95th-percentile bar gap means a
# halt or a data hole, which renders as a misleading flat stretch.
#
# The percentile matters. An earlier version used the median, which killed the
# hourly timeframe outright: the median gap between hourly bars is one hour, but
# 60 hourly bars span about nine trading days for an equity, so every window
# contained an overnight close and every window was rejected. The 95th percentile
# absorbs whatever session structure the instrument actually has: overnight closes
# for equities, nothing at all for 24/7 crypto. Only genuine holes then stand out.
MAX_GAP_MULTIPLE = 5
GAP_PERCENTILE = 0.95

MIN_TOTAL_QUESTIONS = 200


# --- monthly aggregation -----------------------------------------------------


def aggregate_monthly(daily):
    """Groups daily bars into calendar months. The trailing month is dropped
    because it is partial and we cannot tell how much of it is missing."""
    groups = []
    current_key = None
    for b in daily:
        moment = datetime.fromtimestamp(b["t"], tz=timezone.utc)
        key = (moment.year, moment.month)
        if key != current_key:
            groups.append([])
            current_key = key
        groups[-1].append(b)

    months = []
    for group in groups[:-1]:
        months.append(
            {
                "t": group[0]["t"],
                "o": group[0]["o"],
                "h": max(b["h"] for b in group),
                "l": min(b["l"] for b in group),
                "c": group[-1]["c"],
                "v": sum(b["v"] for b in group),
            }
        )
    return months


# --- window slicing ----------------------------------------------------------


def slice_windows(bars, horizon):
    """Every STRIDE-th window that fits entirely inside the series."""
    windows = []
    limit = len(bars) - SETUP_LENGTH - horizon + 1
    for start in range(0, max(0, limit), STRIDE):
        windows.append(
            {
                "start": start,
                "setup": bars[start : start + SETUP_LENGTH],
                "future": bars[start + SETUP_LENGTH : start + SETUP_LENGTH + horizon],
            }
        )
    return windows


def answer_of(setup, future):
    """Direction of the move, or None when it is too small to be a real question.

    Compares the price difference against a scaled threshold rather than computing
    a ratio. Dividing and then subtracting one loses precision on a move this small,
    which puts the boundary at the mercy of floating point rounding.
    """
    last = setup[-1]["c"]
    if last <= 0:
        return None
    delta = future[-1]["c"] - last
    if abs(delta) < TIE_THRESHOLD * last:
        return None
    return "up" if delta > 0 else "down"


def gap_threshold(bars):
    """The longest jump this series is allowed to contain, in seconds.

    Derived from the series' own gap distribution rather than a fixed number, so a
    24/7 crypto series and a 6.5-hour equity session are each judged against what
    is normal for them. Returns 0 when there is nothing to measure, which disables
    the check.
    """
    gaps = sorted(b["t"] - a["t"] for a, b in zip(bars, bars[1:]) if b["t"] > a["t"])
    if not gaps:
        return 0
    index = min(len(gaps) - 1, int(len(gaps) * GAP_PERCENTILE))
    return MAX_GAP_MULTIPLE * gaps[index]


def reject_reason(setup, future, max_gap):
    """None when the window is usable, otherwise the rule that rejected it."""
    window = list(setup) + list(future)

    for b in window:
        v = b.get("v")
        if v is None or not isinstance(v, (int, float)) or v <= 0:
            return "volume"

    for b in window:
        o, h, l, c = b["o"], b["h"], b["l"], b["c"]
        if min(o, h, l, c) <= 0:
            return "corrupt"
        if h < l or not (l <= o <= h) or not (l <= c <= h):
            return "corrupt"

    if max_gap > 0:
        for a, b in zip(window, window[1:]):
            if b["t"] - a["t"] > max_gap:
                return "gap"

    return None


# --- balancing ---------------------------------------------------------------


def balance_buckets(candidates, seed=0, cap_per_bucket=None):
    """Within every (assetClass, timeframe, horizon) bucket, keep an equal number
    of up and down answers. Without this, swiping right on everything wins and the
    whole report is noise. A bucket that only ever moved one way is dropped."""
    buckets = defaultdict(lambda: {"up": [], "down": []})
    for q in sorted(candidates, key=lambda q: q["id"]):
        key = (q["assetClass"], q["timeframe"], q["horizon"])
        buckets[key][q["answer"]].append(q)

    rng = random.Random(seed)
    out = []
    for key in sorted(buckets):
        sides = buckets[key]
        take = min(len(sides["up"]), len(sides["down"]))
        if cap_per_bucket is not None:
            take = min(take, cap_per_bucket // 2)
        if take == 0:
            continue
        out.extend(rng.sample(sides["up"], take))
        out.extend(rng.sample(sides["down"], take))
    return out


# --- shipping ----------------------------------------------------------------


def question_id(source, symbol, timeframe, horizon, start_epoch):
    """Opaque and stable across rebuilds. Opaque matters: a readable id would
    reintroduce the ticker that anonymisation just removed."""
    raw = f"{source}|{symbol}|{timeframe}|{horizon}|{start_epoch}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def _sig4(x):
    if x == 0:
        return 0.0
    digits = 4 - int(math.floor(math.log10(abs(x)))) - 1
    return round(x, digits)


def ship_bar(b):
    """Drops the timestamp. A shipped bar carries no date, by construction."""
    return {
        "o": _sig4(b["o"]),
        "h": _sig4(b["h"]),
        "l": _sig4(b["l"]),
        "c": _sig4(b["c"]),
        "v": int(round(b["v"])),
    }


# --- pipeline ----------------------------------------------------------------


def load_cache(cache_dir):
    series = []
    if not os.path.isdir(cache_dir):
        return series
    for name in sorted(os.listdir(cache_dir)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(cache_dir, name), "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, ValueError) as exc:
            print(f"  [skip] {name}: {exc}")
            continue
        if payload.get("bars"):
            series.append(payload)
    return series


def expand_series(series):
    """Yields (source, symbol, assetClass, timeframe, bars), deriving monthly from
    daily rather than fetching it: no free source gives enough monthly history."""
    for s in series:
        yield s["source"], s["symbol"], s["assetClass"], s["timeframe"], s["bars"]
        if s["timeframe"] == "1d":
            months = aggregate_monthly(s["bars"])
            if months:
                yield s["source"], s["symbol"], s["assetClass"], "1mo", months


def build_candidates(series):
    candidates = []
    rejections = defaultdict(int)

    for source, symbol, asset_class, timeframe, bars in expand_series(series):
        if len(bars) < SETUP_LENGTH + max(HORIZONS) + STRIDE:
            rejections["series too short"] += 1
            continue
        max_gap = gap_threshold(bars)

        for horizon in HORIZONS:
            for window in slice_windows(bars, horizon):
                reason = reject_reason(window["setup"], window["future"], max_gap)
                if reason:
                    rejections[reason] += 1
                    continue
                answer = answer_of(window["setup"], window["future"])
                if answer is None:
                    rejections["tie"] += 1
                    continue
                candidates.append(
                    {
                        "id": question_id(
                            source, symbol, timeframe, horizon, window["setup"][0]["t"]
                        ),
                        "assetClass": asset_class,
                        "timeframe": timeframe,
                        "horizon": horizon,
                        "symbol": symbol,
                        "startTime": window["setup"][0]["t"],
                        "endTime": window["future"][-1]["t"],
                        "setup": [ship_bar(b) for b in window["setup"]],
                        "future": [ship_bar(b) for b in window["future"]],
                        "answer": answer,
                    }
                )

    return candidates, rejections


def select_demo_questions(questions, count=4):
    """Pick the questions the landing page plays on loop.

    Spread across timeframes so the demo shows a minute chart and a monthly one
    rather than four of the same thing, and evenly spaced within each timeframe so
    the picks are not all neighbours from the same instrument and period.

    Deterministic: sorted by id first, so the same bank always yields the same
    four. The browser excludes these ids from real rounds, and that only works if
    both sides agree on which four they are.
    """
    if count <= 0:
        return []

    by_timeframe = defaultdict(list)
    for question in sorted(questions, key=lambda q: q["id"]):
        by_timeframe[question["timeframe"]].append(question)

    # Round-robin across the timeframes present, taking evenly spaced picks.
    groups = [by_timeframe[tf] for tf in ("1m", "1h", "1d", "1mo") if by_timeframe[tf]]
    chosen = []
    depth = 0
    while len(chosen) < count and groups:
        for group in groups:
            if len(chosen) >= count:
                break
            if depth >= len(group):
                continue
            # Spread the picks over the group rather than taking the first few.
            stride = max(1, len(group) // count)
            index = min(len(group) - 1, depth * stride)
            chosen.append(group[index])
        if all(depth >= len(group) for group in groups):
            break
        depth += 1
    return chosen[:count]


def load_shipped_bank(out_dir):
    """Read back the shards already in `out_dir`, for rebuilding demo.json alone."""
    manifest_path = os.path.join(out_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        return []
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)
    questions = []
    for shard in manifest.get("shards", []):
        path = os.path.join(out_dir, shard["file"])
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            questions.extend(json.load(fh))
    return questions


def write_demo(questions, out_dir, count=4):
    """Write the small file the landing page fetches at boot.

    A few KB, so the landing page can animate without pulling a 1.8 MB shard.
    """
    demo = select_demo_questions(questions, count=count)
    os.makedirs(out_dir, exist_ok=True)
    payload = {"version": 1, "questions": demo}
    with open(os.path.join(out_dir, "demo.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    return demo


def write_bank(questions, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    by_timeframe = defaultdict(list)
    for q in questions:
        by_timeframe[q["timeframe"]].append(q)

    shards = []
    for timeframe in ("1m", "1h", "1d", "1mo"):
        items = by_timeframe.get(timeframe)
        if not items:
            continue
        filename = f"questions-{timeframe}.json"
        with open(os.path.join(out_dir, filename), "w", encoding="utf-8") as fh:
            json.dump(items, fh, separators=(",", ":"))
        shards.append(
            {
                "timeframe": timeframe,
                "file": filename,
                "count": len(items),
                "assetClasses": sorted({q["assetClass"] for q in items}),
                "horizons": sorted({q["horizon"] for q in items}),
            }
        )

    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "setupLength": SETUP_LENGTH,
        "shards": shards,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    return manifest


def main(argv=None):
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description="Build the tickread question bank.")
    parser.add_argument("--cache", default=os.path.join(here, ".cache"))
    parser.add_argument("--out", default=os.path.join(here, "..", "data"))
    parser.add_argument("--target", type=int, default=1500)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--demo-only",
        action="store_true",
        help=(
            "Rebuild data/demo.json from the already-shipped shards and touch "
            "nothing else. A full rebuild renumbers every question, which throws "
            "away what players have already been shown."
        ),
    )
    args = parser.parse_args(argv)

    if args.demo_only:
        shipped = load_shipped_bank(args.out)
        if not shipped:
            print(f"No shards found in {args.out}. Run a full build first.", file=sys.stderr)
            return 1
        demo = write_demo(shipped, args.out)
        print(f"Wrote {os.path.join(args.out, 'demo.json')} from {len(shipped)} shipped questions")
        for question in demo:
            print(f"  {question['timeframe']:<4} h={question['horizon']:<3} {question['id']}")
        return 0

    series = load_cache(args.cache)
    print(f"Loaded {len(series)} cached series from {args.cache}")
    if not series:
        print("Nothing to build. Run fetch_stooq.py (and optionally fetch_polygon.py) first.")
        return 1

    candidates, rejections = build_candidates(series)
    print(f"\n{len(candidates)} candidate windows survived the rejection rules")
    for reason, count in sorted(rejections.items()):
        print(f"  rejected, {reason}: {count}")

    bucket_count = len({(q["assetClass"], q["timeframe"], q["horizon"]) for q in candidates})
    cap = max(2, (args.target // max(1, bucket_count)) // 2 * 2) if bucket_count else None
    questions = balance_buckets(candidates, seed=args.seed, cap_per_bucket=cap)
    print(f"{len(questions)} questions after balancing across {bucket_count} buckets")

    if len(questions) < MIN_TOTAL_QUESTIONS:
        print(
            f"\nOnly {len(questions)} questions built, below the {MIN_TOTAL_QUESTIONS} "
            "minimum. Shipping a bank this thin would be worse than failing.",
            file=sys.stderr,
        )
        return 1

    manifest = write_bank(questions, args.out)
    write_demo(questions, args.out)
    print(f"\nWrote {args.out}")
    print(f"{'timeframe':<10} {'count':>6}  asset classes")
    for shard in manifest["shards"]:
        print(f"{shard['timeframe']:<10} {shard['count']:>6}  {', '.join(shard['assetClasses'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
