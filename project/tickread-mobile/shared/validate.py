#!/usr/bin/env python3
"""Shared contract compatibility validator. Standard library only.

Checks:
  [1] Fixture questions conform to QuestionDefinition schema
  [2] Fixture sessions conform to SessionRecord schema
  [3] correct = (given == answer) for every fixture session
  [4] Stats recomputed from sessions match fixtures/expected.json exactly
  [5] Live bank manifest conforms to manifest schema (skipped if not found)
  [6] First question of each live shard conforms to QuestionDefinition schema

Run from the project root:
    python project/tickread-mobile/shared/validate.py

Or from the tickread-mobile directory:
    python shared/validate.py

Exit 0 = all checks pass. Exit 1 = at least one failure.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
TICKREAD_DATA = os.path.join(ROOT, "project", "tickread", "code", "data")
FIXTURES_DIR = os.path.join(HERE, "fixtures")

_failures = []
_checks = 0


def _fail(msg):
    _failures.append(msg)
    print(f"    FAIL  {msg}")


def _ok(msg):
    global _checks
    _checks += 1
    print(f"    pass  {msg}")


def _section(title):
    print(f"\n[{'.' * (40 - len(title))}] {title}")


# ---------------------------------------------------------------------------
# Schema validator (stdlib, no jsonschema dependency)
# ---------------------------------------------------------------------------

_PYTHON_TYPES = {
    "string": str,
    "number": (int, float),
    "integer": int,
    "boolean": bool,
    "array": list,
    "object": dict,
}


def _check_type(value, t, path):
    if t == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            _fail(f"{path}: expected integer, got {type(value).__name__}")
            return False
    elif t == "boolean":
        if not isinstance(value, bool):
            _fail(f"{path}: expected boolean, got {type(value).__name__}")
            return False
    else:
        pt = _PYTHON_TYPES.get(t)
        if pt and not isinstance(value, pt):
            _fail(f"{path}: expected {t}, got {type(value).__name__}")
            return False
    return True


def _validate_bar(bar, path):
    if not isinstance(bar, dict):
        _fail(f"{path}: expected object, got {type(bar).__name__}")
        return
    for field in ("o", "h", "l", "c", "v"):
        if field not in bar:
            _fail(f"{path}: missing field '{field}'")
            return
    _check_type(bar["v"], "integer", f"{path}.v")
    if not isinstance(bar.get("v"), int) or isinstance(bar.get("v"), bool) or bar["v"] < 1:
        _fail(f"{path}.v: must be integer >= 1")
    for f in ("o", "h", "l", "c"):
        if not _check_type(bar[f], "number", f"{path}.{f}"):
            continue
        if bar[f] <= 0:
            _fail(f"{path}.{f}: must be > 0, got {bar[f]}")
    o, h, l, c = bar.get("o"), bar.get("h"), bar.get("l"), bar.get("c")
    if isinstance(h, (int, float)) and isinstance(l, (int, float)):
        if h < l:
            _fail(f"{path}: h={h} < l={l}")
        if isinstance(o, (int, float)) and not (l <= o <= h):
            _fail(f"{path}: o={o} outside [l={l}, h={h}]")
        if isinstance(c, (int, float)) and not (l <= c <= h):
            _fail(f"{path}: c={c} outside [l={l}, h={h}]")


def validate_question(q, path="question"):
    if not isinstance(q, dict):
        _fail(f"{path}: expected object")
        return
    required = ["id", "assetClass", "timeframe", "horizon", "symbol",
                "startTime", "endTime", "setup", "future", "answer"]
    for field in required:
        if field not in q:
            _fail(f"{path}: missing required field '{field}'")
            return
    _check_type(q["id"], "string", f"{path}.id")
    _check_type(q["assetClass"], "string", f"{path}.assetClass")
    if q.get("assetClass") not in ("equity", "crypto", "forex", "commodity", "index"):
        _fail(f"{path}.assetClass: unexpected value '{q.get('assetClass')}'")
    _check_type(q["timeframe"], "string", f"{path}.timeframe")
    if q.get("timeframe") not in ("1m", "1h", "1d", "1mo"):
        _fail(f"{path}.timeframe: unexpected value '{q.get('timeframe')}'")
    _check_type(q["horizon"], "integer", f"{path}.horizon")
    if isinstance(q.get("horizon"), int) and q["horizon"] < 1:
        _fail(f"{path}.horizon: must be >= 1")
    _check_type(q["symbol"], "string", f"{path}.symbol")
    _check_type(q["startTime"], "integer", f"{path}.startTime")
    _check_type(q["endTime"], "integer", f"{path}.endTime")
    _check_type(q["setup"], "array", f"{path}.setup")
    _check_type(q["future"], "array", f"{path}.future")
    if q.get("answer") not in ("up", "down"):
        _fail(f"{path}.answer: must be 'up' or 'down', got '{q.get('answer')}'")
    if isinstance(q.get("setup"), list):
        if len(q["setup"]) < 1:
            _fail(f"{path}.setup: must have at least 1 bar")
        for i, bar in enumerate(q["setup"]):
            _validate_bar(bar, f"{path}.setup[{i}]")
    if isinstance(q.get("future"), list):
        if len(q["future"]) < 1:
            _fail(f"{path}.future: must have at least 1 bar")
        for i, bar in enumerate(q["future"]):
            _validate_bar(bar, f"{path}.future[{i}]")


def validate_session(s, path="session"):
    if not isinstance(s, dict):
        _fail(f"{path}: expected object")
        return
    required = ["schemaVersion", "questionId", "given", "answer", "correct", "responseMs", "answeredAt"]
    for field in required:
        if field not in s:
            _fail(f"{path}: missing required field '{field}'")
            return
    if s.get("schemaVersion") != 1:
        _fail(f"{path}.schemaVersion: expected 1, got {s.get('schemaVersion')}")
    _check_type(s["questionId"], "string", f"{path}.questionId")
    if s.get("given") not in ("up", "down"):
        _fail(f"{path}.given: must be 'up' or 'down', got '{s.get('given')}'")
    if s.get("answer") not in ("up", "down"):
        _fail(f"{path}.answer: must be 'up' or 'down', got '{s.get('answer')}'")
    _check_type(s["correct"], "boolean", f"{path}.correct")
    _check_type(s["responseMs"], "integer", f"{path}.responseMs")
    _check_type(s["answeredAt"], "string", f"{path}.answeredAt")
    # correct must equal (given == answer)
    if isinstance(s.get("correct"), bool):
        expected_correct = s.get("given") == s.get("answer")
        if s["correct"] != expected_correct:
            _fail(f"{path}: correct={s['correct']} but given={s['given']} answer={s['answer']} "
                  f"→ should be {expected_correct}")


def validate_manifest(m, path="manifest"):
    if not isinstance(m, dict):
        _fail(f"{path}: expected object")
        return
    for field in ("version", "generatedAt", "setupLength", "shards"):
        if field not in m:
            _fail(f"{path}: missing required field '{field}'")
            return
    _check_type(m["version"], "integer", f"{path}.version")
    _check_type(m["generatedAt"], "string", f"{path}.generatedAt")
    _check_type(m["setupLength"], "integer", f"{path}.setupLength")
    _check_type(m["shards"], "array", f"{path}.shards")
    for i, shard in enumerate(m.get("shards", [])):
        sp = f"{path}.shards[{i}]"
        for field in ("timeframe", "file", "count", "assetClasses", "horizons"):
            if field not in shard:
                _fail(f"{sp}: missing '{field}'")
        if shard.get("timeframe") not in ("1m", "1h", "1d", "1mo"):
            _fail(f"{sp}.timeframe: unexpected value '{shard.get('timeframe')}'")
        _check_type(shard.get("count", 0), "integer", f"{sp}.count")


# ---------------------------------------------------------------------------
# Stat recomputation
# ---------------------------------------------------------------------------

def _compute_stats(sessions, questions):
    q_map = {q["id"]: q for q in questions}
    total = len(sessions)
    n_correct = sum(1 for s in sessions if s.get("correct"))

    def group(key_fn):
        g = {}
        for s in sessions:
            q = q_map.get(s.get("questionId"))
            if q is None:
                continue
            k = key_fn(q)
            if k not in g:
                g[k] = {"total": 0, "correct": 0}
            g[k]["total"] += 1
            if s.get("correct"):
                g[k]["correct"] += 1
        for k in g:
            g[k]["hit_rate"] = round(g[k]["correct"] / g[k]["total"], 4)
        return g

    return {
        "total": total,
        "correct": n_correct,
        "hit_rate": round(n_correct / total, 4) if total else 0.0,
        "by_asset_class": group(lambda q: q["assetClass"]),
        "by_timeframe":   group(lambda q: q["timeframe"]),
        "by_horizon":     group(lambda q: str(q["horizon"])),
    }


def _assert_stats_match(actual, expected, label):
    ok = True
    for key in ("total", "correct", "hit_rate"):
        if actual.get(key) != expected.get(key):
            _fail(f"{label}.{key}: expected {expected.get(key)!r}, got {actual.get(key)!r}")
            ok = False
    for grp in ("by_asset_class", "by_timeframe", "by_horizon"):
        ag = actual.get(grp, {})
        eg = expected.get(grp, {})
        for k, ev in eg.items():
            if k not in ag:
                _fail(f"{label}.{grp}.{k}: missing in recomputed stats")
                ok = False
                continue
            for metric in ("total", "correct", "hit_rate"):
                if ag[k].get(metric) != ev.get(metric):
                    _fail(f"{label}.{grp}[{k}].{metric}: expected {ev.get(metric)!r}, "
                          f"got {ag[k].get(metric)!r}")
                    ok = False
    return ok


# ---------------------------------------------------------------------------
# Main checks
# ---------------------------------------------------------------------------

def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def check_fixtures():
    q_path = os.path.join(FIXTURES_DIR, "questions.json")
    s_path = os.path.join(FIXTURES_DIR, "sessions.json")
    e_path = os.path.join(FIXTURES_DIR, "expected.json")

    for p in (q_path, s_path, e_path):
        if not os.path.exists(p):
            _fail(f"Missing fixture file: {p}")
            return

    questions = _load(q_path)
    sessions  = _load(s_path)
    expected  = _load(e_path)

    _section("Fixture question schema")
    before = len(_failures)
    for i, q in enumerate(questions):
        validate_question(q, f"questions[{i}]")
    if len(_failures) == before:
        _ok(f"{len(questions)} questions all valid")

    _section("Fixture session schema + correct field")
    before = len(_failures)
    for i, s in enumerate(sessions):
        validate_session(s, f"sessions[{i}]")
    if len(_failures) == before:
        _ok(f"{len(sessions)} sessions all valid, correct = (given == answer) in every case")

    _section("Fixture stat recomputation")
    before = len(_failures)
    actual = _compute_stats(sessions, questions)
    if _assert_stats_match(actual, expected, "stats"):
        _ok(f"Recomputed stats match expected.json  "
            f"hit_rate={actual['hit_rate']}  "
            f"correct={actual['correct']}/{actual['total']}")

    return questions


def check_live_bank(fixture_questions):
    manifest_path = os.path.join(TICKREAD_DATA, "manifest.json")
    if not os.path.exists(manifest_path):
        _section("Live bank (skipped — manifest.json not found)")
        print(f"    skip  expected at {manifest_path}")
        return

    _section("Live bank manifest schema")
    manifest = _load(manifest_path)
    before = len(_failures)
    validate_manifest(manifest)
    if len(_failures) == before:
        shards = manifest.get("shards", [])
        total_q = sum(s.get("count", 0) for s in shards)
        _ok(f"manifest.json valid — version={manifest.get('version')}  "
            f"{len(shards)} shards  {total_q} total questions")

    _section("Live bank: first question of each shard")
    for shard in manifest.get("shards", []):
        shard_path = os.path.join(TICKREAD_DATA, shard.get("file", ""))
        if not os.path.exists(shard_path):
            _fail(f"Shard file not found: {shard_path}")
            continue
        rows = _load(shard_path)
        if not rows:
            _fail(f"{shard['file']}: empty shard")
            continue
        before = len(_failures)
        validate_question(rows[0], f"{shard['file']}[0]")
        if len(_failures) == before:
            _ok(f"{shard['file']}: {len(rows)} questions, first question valid")

    _section("Fixture question IDs are absent from live bank (no duplicates)")
    fixture_ids = {q["id"] for q in (fixture_questions or [])}
    if not fixture_ids:
        return
    live_ids = set()
    for shard in manifest.get("shards", []):
        shard_path = os.path.join(TICKREAD_DATA, shard.get("file", ""))
        if os.path.exists(shard_path):
            for row in _load(shard_path):
                live_ids.add(row.get("id"))
    overlap = fixture_ids & live_ids
    if overlap:
        _fail(f"Fixture IDs found in live bank (ID collision): {overlap}")
    else:
        _ok(f"No fixture IDs collide with the {len(live_ids)} live question IDs")


def main():
    print("tickread-mobile — shared contract validator")
    print("=" * 44)

    fixture_questions = check_fixtures()
    check_live_bank(fixture_questions)

    print(f"\n{'=' * 44}")
    if _failures:
        print(f"FAILED — {len(_failures)} issue(s) found:")
        for f in _failures:
            print(f"  • {f}")
        sys.exit(1)
    else:
        print(f"All {_checks} checks passed.")
        sys.exit(0)


if __name__ == "__main__":
    main()
