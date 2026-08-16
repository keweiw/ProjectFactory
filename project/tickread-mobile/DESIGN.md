# tickread Mobile — Product & System Design

**Status:** DESIGN_DRAFT  
**Date:** 2026-08-15  
**Revised:** 2026-08-16  
**Related product:** `project/tickread`

---

## 1. Vision

tickread Mobile is a single-hand market-intuition training app for phones. The user sees a candlestick chart with the ticker, dates, and future bars hidden, then swipes up (bullish) or down (bearish) within a time limit. After locking in the answer, the future bars animate in and the real ticker, timeframe, and date range are revealed. Repeated sessions accumulate into a personal ability report that shows where the user's edge is strongest and where calibration is weakest.

This is a training tool, not a trading tool. It provides no real-time prices, buy/sell signals, or investment advice.

---

## 2. Product Principles

1. **Judge first, reveal after.** Ticker, dates, and future bars are never shown before the user answers. After answering they must always be shown.
2. **One hand, one question.** Swipe up = bullish, swipe down = bearish. Large accessible buttons are a fully equivalent alternative — not a fallback.
3. **Chart is the hero.** No overlaid indicators, news, or trading tips. One question per screen.
4. **Offline first.** A downloaded question bank and local history work without a network connection.
5. **One question, one answer.** PWA, Capacitor shell, and any future Unity client must produce the same `correct` result and the same statistics for the same input. The shared contract is the source of truth, not each client's implementation.
6. **Stats earn their place.** Subcategory breakdowns (by asset class, timeframe, horizon) are only shown once enough samples exist. A "not enough data yet" message is more honest than a percentage from 2 answers.

---

## 3. Milestones

The project is delivered in five milestones. Each milestone produces a shippable, testable artifact before the next one starts. Unity is intentionally deferred until the PWA experience is validated.

```
M0 ── Shared Foundation
M1 ── Mobile Web MVP
M2 ── History & Cumulative Report
M3 ── PWA Polish & Offline
M4 ── Capacitor Native Shell   (starts only after M3 is validated)
M5 ── Unity Client             (scope to be decided; not on the critical path)
```

---

### M0 · Shared Foundation

**Goal:** Lock the data contract and validate the build pipeline before any UI work starts. Both the web client and any future Unity client depend on this being stable.

**Deliverables**

| Artifact | Description |
|---|---|
| `shared/CONTRACT.md` | Finalised schemas for `QuestionDefinition`, `SessionRecord`, and `manifest.v2.json` |
| `shared/fixtures/` | At least 5 fixed questions with pre-computed expected statistics (hit rate, groupings) |
| Pipeline validation | `project/tickread/scripts/build_deck.py` outputs a manifest + question bank that passes JSON Schema validation against CONTRACT.md schemas |
| Compatibility test | A lightweight script that runs the fixtures and asserts `correct`, hit rate, and grouped stats match expected values |

**Done when:** The pipeline produces a validated content package and the fixture tests pass. No UI is required.

---

### M1 · Mobile Web MVP

**Goal:** A working phone UI where a user can complete a full 10-question round, see the answer revealed after each question, and get a basic end-of-round summary. This is a **new mobile-first UI** built on the shared contract and the existing TypeScript + question-bank pipeline. It is not a port of the existing desktop tickread app.

**Deliverables**

| Screen | Minimum content |
|---|---|
| Home | App title, start button, total lifetime hit rate (or "no history yet") |
| Question screen | K-line chart (setup bars only), swipe gesture + up/down buttons, question counter, streak badge |
| Reveal screen | Future bars animate in, result card (correct/wrong, actual move %, ticker, timeframe, date range, response time), next-question button |
| Round report | Total hit rate for this round, longest streak this round, list of 10 questions with correct/wrong indicator |

**Input contract**
- Up swipe / Up button → `given: "up"`
- Down swipe / Down button → `given: "down"`
- Swipe must have a threshold; a partial drag snaps back if not committed

**Not in M1**
- Cumulative stats across rounds
- Offline / Service Worker
- PWA install prompt
- Haptic feedback

**Done when:** A user on a real phone can complete a 10-question round end-to-end, results are stored in `localStorage`, and the fixture compatibility test still passes.

---

### M2 · History & Cumulative Report

**Goal:** Make repeated training sessions meaningful by accumulating results and showing the user where their skill is developing over time.

**Deliverables**

| Feature | Detail |
|---|---|
| Persistent history | All `SessionRecord` entries stored in `localStorage`, keyed by `questionId` |
| Cumulative home screen | Lifetime hit rate, total questions answered, current streak across sessions |
| Full report | Hit rate over time (sparkline), subcategory breakdown by asset class / timeframe / horizon — **only shown when that subcategory has ≥ 20 answers** |
| Decision style | Response-time distribution, bullish/bearish bias — shown when ≥ 30 total answers |
| Sample-size guard | Any stat with fewer than the threshold shows "not enough data yet" — no fabricated 0% or 100% |
| Export / Import | User can export session history as JSON and re-import it on a new device |
| Clear history | Settings option to wipe local data |

**Done when:** After three simulated rounds (using fixtures), the cumulative report shows correct grouped stats and correctly withholds subcategory breakdowns where sample is below threshold.

---

### M3 · PWA Polish & Offline

**Goal:** Make the app installable, fully offline-capable, and production-quality on mobile.

**Deliverables**

| Feature | Detail |
|---|---|
| Service Worker | Caches app shell and current question bank; background-updates on next launch without interrupting an in-progress round |
| Web App Manifest | Name, icons, `display: standalone`, theme colour — enables "Add to Home Screen" on iOS and Android |
| Haptic feedback | `navigator.vibrate()` on answer lock and reveal (correct vs wrong), with `prefers-reduced-motion` respected |
| Accessibility audit | Colour + arrow + text (never colour alone), minimum 52 px touch targets, dynamic type, VoiceOver / TalkBack tested |
| Dark mode | `prefers-color-scheme` + manual toggle |
| Reduced-motion | All reveal animations respect `prefers-reduced-motion: reduce` |
| Question bank versioning | Manifest version check on launch; if a newer bank is available, download in background and activate on next round start |

**Done when:** App passes Lighthouse PWA audit (≥ 90), installs to home screen on both iOS and Android, and completes a full round with no network connection after first load.

---

### M4 · Capacitor Native Shell *(starts after M3 is validated in production)*

**Goal:** Wrap the PWA in Capacitor to get App Store distribution, native haptics, and local file access.

**Prerequisite:** At least 4 weeks of real-user PWA usage showing the core experience works and no major UX pivots are needed.

**Deliverables**

| Feature | Detail |
|---|---|
| Capacitor project | iOS and Android targets wrapping the M3 PWA |
| Native haptics | Replace `vibrate()` with `@capacitor/haptics` for richer feedback patterns |
| App Store submission | TestFlight (iOS) and Play Console internal track (Android) builds |
| File-based history | Optionally migrate `localStorage` to `@capacitor/filesystem` for more robust persistence |

**Not in M4**
- Cloud sync
- Accounts
- Push notifications

**Done when:** Both platforms pass store review and at least one internal tester completes a session on device.

---

### M5 · Unity Client *(scope to be decided)*

Unity is not on the critical path and its scope is not yet defined. Three open questions must be answered before this milestone is planned:

1. Is Unity a standalone mobile app, a desktop training client, or embedded in an existing Unity game?
2. Does it ship with a bundled question bank (larger install, instant start) or download on first launch?
3. Is the PWA maintained in parallel long-term, or does Unity replace it?

Until those are decided, M5 is a placeholder. The shared contract (M0) is designed to support it without changes.

---

## 4. Information Architecture & UI

### 4.1 Home Screen

App title, lifetime hit rate and total questions answered (or "start your first round"), and a single primary button: **Start 10 questions**. Three secondary entries: History, Settings, About. No real-time prices, market news, or recommendations.

### 4.2 Question Screen

```
┌────────────────────────────────────┐
│  DAILY · US EQUITY · NEXT 5 BARS   │
│  4 / 10                 streak 2   │
│                                    │
│       Where does price go?          │
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │      K-line + volume         │  │
│  │    (future bars hidden)      │  │
│  │                              │  │
│  └──────────────────────────────┘  │
│                                    │
│   [ ↓ Bearish / Falls ]  [ ↑ Bullish / Rises ]  │
│        or swipe down / up           │
└────────────────────────────────────┘
```

- Chart occupies 55–65% of available height, with safe-area insets respected.
- A partial swipe beyond threshold commits and locks; below threshold the card snaps back.
- Arrow keys work for desktop debugging; they are not the primary affordance on phone.

### 4.3 Reveal Screen

The card stays in place. Future bars animate in one by one. After the final bar, the result card appears:

```
Correct — price rose 2.4%
AAPL · Daily · 05 Mar 2025 – 12 Mar 2025
Your call: Bullish · 1.3 s
```

Result stays visible for at least 2.2 seconds. The user can tap **Next** immediately after that. This prevents熟练 users from being blocked by a fixed wait while giving casual users time to absorb the real answer.

### 4.4 Round Report

After 10 questions: hit rate for this round, longest streak, and a card for each question showing correct/wrong and the actual move. Cumulative stats and subcategory analysis are on the separate History screen (M2), not here.

### 4.5 Visual Language & Accessibility

- Dark graphite background, warm-white content cards.
- Bullish = green with ↑ arrow and text label. Bearish = red with ↓ arrow and text label. Colour is never the only signal.
- Price numbers in monospace; body copy in system font.
- Supports dark mode, `prefers-reduced-motion`, dynamic type, and screen-reader status announcements.

---

## 5. System Architecture

```
[Python build pipeline]
    ↓ produces
[shared content package]
  question-bank.v2.json
  manifest.v2.json
  fixtures/
    ↓ consumed by
[PWA / Capacitor client]          [Unity client — M5, TBD]
    ↓ writes
[local SessionRecord store]
    ↓ optional export
[session-record.v1.json]
```

### 5.1 Content Layer

The Python pipeline in `project/tickread/scripts/` fetches and validates OHLCV data and produces a static question bank. tickread-mobile **reads** this output; it does not rebuild or modify it.

Each question in the bank contains:
- `setup` bars (shown before answering)
- `future` bars (hidden until reveal — see §5.2)
- Ticker, asset class, timeframe, UTC start/end, and pre-computed `answer`

Ticker and dates are rendered only after the user has submitted an answer.

### 5.2 Future Bar Security

`setup` and `future` are both present in the same `QuestionDefinition` JSON object. A client that logs or displays the raw object before reveal would leak the answer.

**Required client behaviour (mandatory, part of compatibility contract):**
- Before the user submits: render only `setup` bars. Do not read, log, or expose `future`, `answer`, `symbol`, `startTime`, or `endTime`.
- After submission: lock the input, then begin animating `future` bars, then display `symbol`, `startTime`, and `endTime` formatted in the device locale.

This is enforced through fixture tests: a fixture test simulates an answer and asserts that the reveal fields are only accessed after the `given` value is recorded.

### 5.3 Local Data & Privacy

History is stored on-device only. No login, ad tracking, or server database in M1–M3. Users can export, import, and clear their data from Settings.

---

## 6. Round State Machine

```
[*] → Home
Home → LoadingBank          (Start round)
LoadingBank → QuestionReady (Bank available)
LoadingBank → Error         (Bank unavailable)
QuestionReady → Calling     (Swipe or button tap)
Calling → Revealing         (Input locked; SessionRecord written)
Revealing → Result          (Future bars finish; symbol/dates shown)
Result → QuestionReady      (Next question; round not complete)
Result → RoundReport        (Last question in round)
RoundReport → Home          (Play again / Back)
Error → LoadingBank         (Retry)
```

**Session persistence:** When the app is backgrounded mid-round, the current question index and answers so far are written to `localStorage`. On resume, the round continues from the last unanswered question.

---

## 7. Shared Contract

Full schemas are in `shared/CONTRACT.md`. Key rules:

- UTC timestamps as Unix seconds. No device timezone in stored data.
- Direction enum: `"up"` or `"down"` only — no booleans or localised strings as stored values.
- Prices as JSON numbers; display formatting is each client's responsibility.
- Question IDs are stable hashes with no readable ticker embedded — ticker and dates are separate reveal fields.
- The build pipeline validates output against JSON Schema before publishing.
- PWA and Unity (M5) must produce identical `correct`, hit rate, and grouped stats for the same fixture set.
- **Clients must not access `future`, `answer`, `symbol`, `startTime`, or `endTime` before a `given` value is recorded for that question.**

---

## 8. Data Pipeline Ownership

| Concern | Owner | Location |
|---|---|---|
| Fetch & validate OHLCV data | tickread pipeline | `project/tickread/scripts/build_deck.py` |
| Produce `question-bank.v2.json` + `manifest.v2.json` | tickread pipeline | output path TBD (see Open Items) |
| JSON Schema validation of output | tickread pipeline | runs as part of build |
| Consume content package | tickread-mobile PWA | reads from agreed output path |
| Fixture-based compatibility test | tickread-mobile | `shared/fixtures/` + test script |

The pipeline output path and how tickread-mobile references it (local symlink, copy, or subpath) must be agreed before M1 starts.

---

## 9. Roles

| Role | Responsibility | Primary output |
|---|---|---|
| Product / Design | Training flow, information hierarchy, copy, accessibility | This design doc, acceptance criteria per milestone |
| Data pipeline | Fetch, validate, and build shared question bank | Versioned content package + fixtures |
| PWA client | Mobile UI, offline cache, local history | Installable Web App (M1–M3) |
| QA | Fixture consistency, gesture feel, offline, accessibility | Test reports at each milestone gate |
| Native / Unity | Capacitor shell (M4), Unity client (M5 TBD) | Platform builds |

---

## 10. Non-Goals

- No real-time prices, order entry, price alerts, or investment advice in any milestone.
- PWA and Unity do not share rendering code, Canvas, animations, or UI components — only data.
- No accounts, leaderboards, social sharing, or cloud sync in M1–M3.
- No Unity work before M3 is validated.

---

## 11. Open Items

| # | Question | Blocks |
|---|---|---|
| 1 | What is the agreed output path for the build pipeline's content package, and how does tickread-mobile reference it? | M0 |
| 2 | Should the question bank be bundled with the app at build time, or downloaded on first launch? Bundled = faster start, larger install; downloaded = always fresh, needs network on first use. | M3 |
| 3 | Round length: fixed 10, or user-selectable 5 / 10 / 20? Affects report design and statistical thresholds. | M1 |
| 4 | What is the minimum sample threshold for showing subcategory breakdowns? Proposed: 20 per category, 30 for decision style. | M2 |
| 5 | Unity scope: standalone mobile app, desktop training client, or embedded in an existing Unity game? | M5 |
| 6 | Is the PWA maintained long-term alongside a native app, or does Capacitor/Unity eventually replace it? | M4 / M5 |
