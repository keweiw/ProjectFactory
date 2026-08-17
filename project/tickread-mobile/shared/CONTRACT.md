# tickread Mobile — Shared Content Contract

**Version:** 1  
**Status:** Locked (M0)  
**Design:** [../DESIGN.md](../DESIGN.md)

---

## Purpose

Define the data formats shared by all tickread clients (PWA, Capacitor shell, future Unity). Clients may use different UI frameworks and rendering engines. They must all read the same question bank and produce identical `correct` values and statistics for the same inputs.

Shared here: **what** is stored and how it is structured.  
Not shared: UI code, rendering, animations, or game-engine internals.

---

## Question Bank Format

The pipeline (`project/tickread/code/scripts/build_deck.py`) produces one manifest and one shard file per timeframe. tickread-mobile reads these directly.

```
project/tickread/code/data/
  manifest.json          ← bank index; validate against schemas/manifest.schema.json
  questions-1m.json      ← minute-bar questions
  questions-1h.json      ← hourly questions
  questions-1d.json      ← daily questions
  questions-1mo.json     ← monthly questions
```

The pipeline output is validated against `shared/schemas/manifest.schema.json` as part of the M0 gate. The mobile client reads the manifest to discover which shards exist, then loads shards on demand.

---

## QuestionDefinition

Schema: `schemas/question-definition.schema.json`

```json
{
  "id": "fx6750fa3dc0",
  "assetClass": "equity",
  "timeframe": "1d",
  "horizon": 5,
  "symbol": "AAPL",
  "startTime": 1704067200,
  "endTime": 1704499200,
  "setup":  [{ "o": 150.15, "h": 150.62, "l": 149.87, "c": 150.31, "v": 982340 }],
  "future": [{ "o": 150.31, "h": 152.10, "l": 150.05, "c": 151.88, "v": 1043210 }],
  "answer": "up"
}
```

**Field rules**

| Field | Rule |
|---|---|
| `id` | Stable opaque hash. Does not contain the symbol or dates. Prefix `fx` marks fixture questions. |
| `assetClass` | Enum: `equity`, `etf_index`, `future`, `crypto` |
| `timeframe` | Enum: `1m`, `1h`, `1d`, `1mo` |
| `horizon` | Integer ≥ 1. Number of future bars being predicted. |
| `symbol` | **Reveal-only.** Must not be shown before the user answers. |
| `startTime` | Unix UTC seconds. **Reveal-only.** |
| `endTime` | Unix UTC seconds. **Reveal-only.** |
| `setup` | Bars shown during the question. No timestamps. |
| `future` | **Reveal-only.** Bars animated after answering. Must not be accessed before `given` is recorded. |
| `answer` | **Reveal-only.** Pre-computed correct direction: `"up"` or `"down"`. |

Bars carry no timestamps. A shipped bar is `{ o, h, l, c, v }` only.  
OHLC constraint: `l ≤ o ≤ h` and `l ≤ c ≤ h`. Prices are positive numbers. Volume is a positive integer.

---

## Reveal-field access rule

`symbol`, `startTime`, `endTime`, `future`, and `answer` are reveal-only fields. The client **must not** read, log, or expose these fields before the user's `given` value has been recorded for that question.

This is enforced by the fixture test in `validate.py` (check [2]).

---

## SessionRecord

Schema: `schemas/session-record.schema.json`

```json
{
  "schemaVersion": 1,
  "questionId": "fx6750fa3dc0",
  "given": "up",
  "answer": "up",
  "correct": true,
  "responseMs": 834,
  "answeredAt": "2026-08-16T12:00:00Z"
}
```

**Field rules**

| Field | Rule |
|---|---|
| `schemaVersion` | Must be `1` |
| `questionId` | Matches `QuestionDefinition.id` |
| `given` | User's call: `"up"` or `"down"` |
| `answer` | Copied from `QuestionDefinition.answer` at answer time |
| `correct` | Must equal `(given == answer)`. Clients may recompute on import to verify integrity. |
| `responseMs` | Milliseconds from question display to answer lock. Integer ≥ 0. |
| `answeredAt` | ISO 8601 UTC timestamp. |

Unknown fields must be ignored so that future display metadata does not break older clients.

---

## Manifest

Schema: `schemas/manifest.schema.json`

```json
{
  "version": 1,
  "generatedAt": "2026-08-07T12:00:00+00:00",
  "setupLength": 60,
  "shards": [
    {
      "timeframe": "1d",
      "file": "questions-1d.json",
      "count": 456,
      "assetClasses": ["equity"],
      "horizons": [1, 5, 20]
    }
  ]
}
```

The manifest version is incremented only for breaking shard-format changes. Clients check the version before loading shards.

---

## Encoding rules

| Concern | Rule |
|---|---|
| Timestamps | Unix UTC seconds (integer). No device timezone stored. |
| Direction enum | `"up"` or `"down"` only. No booleans, no localised strings as stored values. |
| Prices | JSON number. Full precision from the pipeline. Display rounding is each client's responsibility. |
| Volume | JSON integer. |
| Unknown fields | Ignore on read. Forward-compatibility for both QuestionDefinition and SessionRecord. |

---

## Statistical thresholds

Subcategory breakdowns are only surfaced once sample size is sufficient. Below the threshold, show "not enough data yet" — never a percentage from 2 answers.

| Stat | Minimum sample |
|---|---|
| Total hit rate | 1 (any sample) |
| By asset class / timeframe / horizon | ≥ 20 per group |
| Decision style (bias, response time) | ≥ 30 total |

---

## Compatibility acceptance

Every change to the question bank schema, scoring, or stats formula requires both clients to verify against the same fixture set before the change ships.

| # | Check | Verified by |
|---|---|---|
| 1 | Fixture questions conform to `question-definition.schema.json` | `validate.py` check [1] |
| 2 | `correct = (given == answer)` for every session record | `validate.py` check [2] |
| 3 | Stats recomputed from sessions match `fixtures/expected.json` | `validate.py` check [3] |
| 4 | Before answering: reveal-only fields are inaccessible until `given` is recorded | `validate.py` access-guard check + client-side guard |
| 5 | Live manifest conforms to `manifest.schema.json` | `validate.py` manifest check |
| 6 | Every question in every live shard conforms to question schema | `validate.py` live-bank check |
| 7 | Fixture IDs do not collide with live-bank IDs | `validate.py` collision check |
| 8 | After answering: reveal shows `symbol`, `startTime`, `endTime` formatted in device locale | UI acceptance test |

Run `python shared/validate.py` from the `tickread-mobile` directory to execute checks 1–5 automatically.
