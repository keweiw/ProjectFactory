#!/usr/bin/env python3
"""Generate shared/fixtures/ from deterministic synthetic OHLCV data.

Produces three committed files:
  fixtures/questions.json  — 5 QuestionDefinition objects
  fixtures/sessions.json   — one SessionRecord per question (deliberate mix of correct/wrong)
  fixtures/expected.json   — pre-computed expected statistics for those sessions

Run from the tickread-mobile directory:
    python shared/generate_fixtures.py

Re-running always produces identical output (fixed seeds). If you change a
FIXTURE_SPEC entry the assertion will fire before any file is written, so the
committed fixtures stay consistent with the spec.
"""
import hashlib
import json
import os
import random

SETUP_LEN = 60

# Each row: (asset_class, timeframe, horizon, answer, start_price,
#            setup_trend_pct, future_trend_pct, seed, vol_base, symbol, start_ts)
#
# future_trend_pct must have |value| > 0.4 to guarantee direction against ±0.4%
# per-bar noise. Use at least ±1.5 for multi-bar and ±2.0 for single-bar.
FIXTURE_SPECS = [
    ("equity", "1d",  5,  "up",    150.00,  0.10,  1.5, 101, 1_000_000, "AAPL",    1704067200),
    ("equity", "1d",  5,  "down",  200.00,  0.10, -1.5, 202, 1_200_000, "MSFT",    1704153600),
    ("equity", "1h",  1,  "up",     80.00,  0.05,  2.0, 303,   500_000, "AMZN",    1704240000),
    ("crypto", "1m",  20, "down", 45000.00,  0.05, -1.5, 404, 50_000_000, "BTC-USD", 1704326400),
    ("equity", "1mo", 1,  "up",    300.00,  0.15,  2.0, 505, 5_000_000, "SPY",     1704412800),
]

# Deliberate answer pattern: correct, wrong, correct, correct, wrong → 3/5 = 0.60
GIVENS = ["up", "up", "up", "down", "down"]


def gen_bars(n, start, trend_pct, seed, vol_base):
    """Deterministic OHLCV bars.

    trend_pct: per-bar price change as a percentage of the current price.
    Noise is uniform ±0.4 pp, so |trend_pct| > 0.4 guarantees direction.
    Uses only uniform() — no gauss — for identical output across platforms.
    """
    rng = random.Random(seed)
    bars = []
    price = start
    for _ in range(n):
        noise = rng.uniform(-0.4, 0.4)
        pct = (trend_pct + noise) / 100.0
        o = round(price, 4)
        c = round(max(0.0001, price * (1.0 + pct)), 4)
        h_extra = price * rng.uniform(0.01, 0.25) / 100.0
        l_extra = price * rng.uniform(0.01, 0.25) / 100.0
        h = round(max(o, c) + h_extra, 4)
        l = round(max(0.0001, min(o, c) - l_extra), 4)
        v = max(1, int(vol_base * rng.uniform(0.70, 1.40)))
        bars.append({"o": o, "h": h, "l": l, "c": c, "v": v})
        price = c
    return bars


def fixture_id(asset, tf, horizon, answer):
    raw = f"fixture|{asset}|{tf}|{horizon}|{answer}|v1"
    return "fx" + hashlib.sha256(raw.encode()).hexdigest()[:10]


def build_questions():
    questions = []
    for spec in FIXTURE_SPECS:
        asset, tf, horizon, answer, start, s_trend, f_trend, seed, vol, symbol, start_ts = spec
        setup = gen_bars(SETUP_LEN, start, s_trend, seed * 10, vol)
        last_c = setup[-1]["c"]
        future = gen_bars(horizon, last_c, f_trend, seed * 10 + 1, vol)
        actual = "up" if future[-1]["c"] > last_c else "down"
        if actual != answer:
            raise AssertionError(
                f"Generated direction '{actual}' does not match expected '{answer}' "
                f"for {asset}/{tf}/h={horizon}. Adjust future_trend_pct or seed."
            )
        questions.append({
            "id": fixture_id(asset, tf, horizon, answer),
            "assetClass": asset,
            "timeframe": tf,
            "horizon": horizon,
            "symbol": symbol,
            "startTime": start_ts,
            "endTime": start_ts + horizon * 86400,
            "setup": setup,
            "future": future,
            "answer": answer,
        })
    return questions


def build_sessions(questions):
    sessions = []
    for q, given in zip(questions, GIVENS):
        sessions.append({
            "schemaVersion": 1,
            "questionId": q["id"],
            "given": given,
            "answer": q["answer"],
            "correct": given == q["answer"],
            "responseMs": 1200,
            "answeredAt": "2026-08-16T12:00:00Z",
        })
    return sessions


def build_expected(sessions, questions):
    q_map = {q["id"]: q for q in questions}
    total = len(sessions)
    n_correct = sum(1 for s in sessions if s["correct"])

    def group(key_fn):
        g = {}
        for s in sessions:
            q = q_map[s["questionId"]]
            k = key_fn(q)
            if k not in g:
                g[k] = {"total": 0, "correct": 0}
            g[k]["total"] += 1
            if s["correct"]:
                g[k]["correct"] += 1
        for k in g:
            g[k]["hit_rate"] = round(g[k]["correct"] / g[k]["total"], 4)
        return g

    return {
        "total": total,
        "correct": n_correct,
        "hit_rate": round(n_correct / total, 4),
        "by_asset_class": group(lambda q: q["assetClass"]),
        "by_timeframe": group(lambda q: q["timeframe"]),
        "by_horizon": group(lambda q: str(q["horizon"])),
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "fixtures")
    os.makedirs(out, exist_ok=True)

    questions = build_questions()
    sessions = build_sessions(questions)
    expected = build_expected(sessions, questions)

    for name, data in [("questions", questions), ("sessions", sessions), ("expected", expected)]:
        path = os.path.join(out, f"{name}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        print(f"Wrote {path}")

    print("\nFixtures:")
    for q, s in zip(questions, sessions):
        mark = "✓" if s["correct"] else "✗"
        print(f"  {mark} {q['id']}  {q['assetClass']}/{q['timeframe']}/h={q['horizon']}  "
              f"answer={q['answer']:<5}  given={s['given']}")

    print(f"\nExpected: {expected['correct']}/{expected['total']} = {expected['hit_rate']:.0%}")
    print(f"by_asset_class : {json.dumps(expected['by_asset_class'])}")
    print(f"by_timeframe   : {json.dumps(expected['by_timeframe'])}")
    print(f"by_horizon     : {json.dumps(expected['by_horizon'])}")


if __name__ == "__main__":
    main()
