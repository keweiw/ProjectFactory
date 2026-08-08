# Tape UI and Swipe Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the answer reveal visible, give the round a live tape and streak, move market data to a monospace face, and replace the landing page's three paragraphs with a chart that plays itself.

**Architecture:** Two new pure modules (`tape.ts`, `demo.ts`) computing state as a function of records and elapsed time; `app.ts` keeps sole ownership of the DOM and does all painting. The report HTML moves out of `app.ts` first so the file being modified is not made larger. `build_deck.py` gains a fourth output holding four demo questions, excluded from real rounds through the `seen` set `buildRound` already accepts.

**Tech Stack:** TypeScript 7 `strict` compiled by `tsc` to native ES modules, vanilla CSS, Python 3 standard library, hand-rolled test harness (`tests/harness.ts`).

**Design:** `project/tickread/docs/plans/2026-08-08-tape-ui-and-swipe-reveal-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/tape.ts` | New. Pure. Records → glyphs and streaks. |
| `src/demo.ts` | New. Pure. Elapsed ms → landing-page animation frame. |
| `src/report-view.ts` | Extracted from `app.ts`. Report HTML only. |
| `src/app.ts` | DOM owner. Answer sequencing, tape painting, demo loop. |
| `tests/tape.test.ts` | New. |
| `tests/demo.test.ts` | New. |
| `tests/app.test.ts` | Gains `revealTimeline` cases. |
| `tests/integration.ts` | Element contract extended; `demo.json` checked. |
| `scripts/build_deck.py` | Also writes `data/demo.json`. |
| `index.html` | Tape, streak, speed, demo-card nodes. |
| `style.css` | Tokens, data face, full-bleed card, tape. |

Verification command throughout, run from `project/tickread/code`:

```bash
npx tsc -p . && node dist/tests/run.js
```

---

## Task 1: Extract the report view

No behaviour change. This makes room in `app.ts` before the answer path is rewritten.

**Files:**
- Create: `src/report-view.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Record the current test count**

Run: `npx tsc -p . && node dist/tests/run.js`
Expected: PASS. Note the total — it must be identical after the move.

- [ ] **Step 2: Move the report rendering functions into `src/report-view.ts`**

Move `renderReport` and every function only it uses (`statTile`, `meterSection`, `axisRow`,
`skillMap`, `trendChart`, `verdictCard`, `formatMetric`, `escapeHtml`, and the table
helpers). Export `renderReport` and `escapeHtml`; keep the rest module-private. The
file imports from `advice.js`, `persona.js`, `stats.js`, `deck.js` and `types.js`
exactly as `app.ts` did.

- [ ] **Step 3: Import it back into `app.ts`**

```ts
import { renderReport } from "./report-view.js";
```

Delete the moved functions and any imports left unused — `noUnusedLocals` is on, so
`tsc` will name them.

- [ ] **Step 4: Verify**

Run: `npx tsc -p . && node dist/tests/run.js`
Expected: PASS with the same total as Step 1.

- [ ] **Step 5: Commit**

```bash
git add project/tickread/code/src/
git commit -m "refactor: move the report view out of app.ts"
```

---

## Task 2: `revealTimeline`

**Files:**
- Modify: `src/app.ts`
- Test: `tests/app.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/app.test.ts`:

```ts
test("revealTimeline draws nothing before the reveal starts", () => {
  const frame = revealTimeline(0, 20);
  equal(frame.revealCount, 0);
  equal(frame.done, false);
});

test("revealTimeline draws at least one bar once it starts", () => {
  equal(revealTimeline(1, 20).revealCount, 1);
});

test("revealTimeline reaches every bar at REVEAL_MS", () => {
  const frame = revealTimeline(REVEAL_MS, 20);
  equal(frame.revealCount, 20);
  equal(frame.done, false);
});

test("revealTimeline is done only after the hold", () => {
  equal(revealTimeline(REVEAL_MS + HOLD_MS - 1, 20).done, false);
  equal(revealTimeline(REVEAL_MS + HOLD_MS, 20).done, true);
});

test("revealTimeline never exceeds the bars it was given", () => {
  equal(revealTimeline(REVEAL_MS * 4, 5).revealCount, 5);
});

test("revealTimeline handles a one-bar horizon", () => {
  equal(revealTimeline(1, 1).revealCount, 1);
  equal(revealTimeline(REVEAL_MS, 1).revealCount, 1);
});
```

Add `revealTimeline`, `REVEAL_MS` and `HOLD_MS` to the existing import from `../src/app.js`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -p .`
Expected: FAIL — `revealTimeline` is not exported from `app.ts`.

- [ ] **Step 3: Implement**

In `src/app.ts`, export the existing constants and add:

```ts
export interface RevealFrame {
  revealCount: number;
  done: boolean;
}

/**
 * Where the reveal is at `elapsedMs`. Pure so the sequencing can be tested
 * without a browser, the same way `shouldCommit` is.
 */
export function revealTimeline(elapsedMs: number, steps: number): RevealFrame {
  if (elapsedMs <= 0) return { revealCount: 0, done: false };
  const ratio = Math.min(1, elapsedMs / REVEAL_MS);
  return {
    revealCount: Math.max(1, Math.min(steps, Math.round(ratio * steps))),
    done: elapsedMs >= REVEAL_MS + HOLD_MS,
  };
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc -p . && node dist/tests/run.js`
Expected: PASS, six tests added.

- [ ] **Step 5: Commit**

```bash
git add project/tickread/code/src/app.ts project/tickread/code/tests/app.test.ts
git commit -m "feat: extract the reveal timeline as a pure function"
```

---

## Task 3: Make the reveal visible

The bug. `commit()` must stop removing the card before `reveal()` paints into it.

**Files:**
- Modify: `src/app.ts` (`commit`, `reveal`, `renderCard`)
- Modify: `style.css`
- Modify: `index.html`

- [ ] **Step 1: Add the call chip to `index.html`**

Inside `<div id="card" class="card">`, after the two `hint` divs:

```html
<div id="call-chip" class="call-chip" hidden></div>
```

Add `"call-chip"` to `REQUIRED_IDS` in `src/app.ts`.

- [ ] **Step 2: Rewrite `commit`**

```ts
function commit(given: Direction): void {
  if (state.busy || state.view !== "deck" || isFinished(state.session)) return;
  state.busy = true;
  // The card stays where the player is looking. Throwing it off screen here is
  // what hid the reveal: the future bars paint into this canvas.
  card.style.transform = "";
  card.classList.remove("tint-up", "tint-down");
  card.classList.add(given === "up" ? "called-up" : "called-down");
  const chip = elements["call-chip"]!;
  chip.textContent = given === "up" ? "▲ YOU SAID UP" : "▼ YOU SAID DOWN";
  chip.hidden = false;
  reveal(given);
}
```

The chip and border colour follow the **call**, never the outcome — colouring by
outcome would spoil the reveal before it draws.

- [ ] **Step 3: Rewrite `reveal` to use `revealTimeline`**

```ts
function reveal(given: Direction): void {
  const question = currentQuestion(state.session)!;
  const responseMs = performance.now() - state.shownAt;
  state.session = answer(state.session, given, responseMs);
  const record = state.session.records[state.session.records.length - 1]!;

  const steps = question.future.length;
  const started = performance.now();
  let verdictShown = false;

  const step = (): void => {
    const frame = revealTimeline(performance.now() - started, steps);
    paint(frame.revealCount);
    if (frame.revealCount >= steps && !verdictShown) {
      verdictShown = true;
      showVerdict(question, record);
    }
    if (!frame.done) {
      requestAnimationFrame(step);
      return;
    }
    if (isFinished(state.session)) finishRound();
    else advanceCard();
  };
  requestAnimationFrame(step);
}
```

- [ ] **Step 4: Add `showVerdict` and `advanceCard`**

```ts
function showVerdict(question: Question, record: AnswerRecord): void {
  const verdict = elements["verdict"]!;
  verdict.textContent = describeOutcome(question, record.correct);
  verdict.className = `verdict ${record.correct ? "good" : "bad"}`;
  renderTape();
}

/** Cross-fade to the next chart rather than snapping to it. */
function advanceCard(): void {
  card.classList.add("swapping");
  window.setTimeout(() => {
    renderCard();
    card.classList.remove("swapping");
  }, 150);
}
```

`renderCard` must also clear the new state:

```ts
card.classList.remove("tint-up", "tint-down", "called-up", "called-down");
elements["call-chip"]!.hidden = true;
```

- [ ] **Step 5: Add the styles**

```css
.card.called-up { border-color: var(--good); }
.card.called-down { border-color: var(--bad); }
.card.swapping { opacity: 0; transition: opacity 0.15s ease-out; }

.call-chip {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  font: 600 0.68rem/1 var(--font-data);
  letter-spacing: 0.1em;
  padding: 0.3rem 0.5rem;
  border-radius: 5px;
  background: var(--surface-2);
  color: var(--muted);
}

@media (prefers-reduced-motion: reduce) {
  .card, .card.swapping { transition: none; }
}
```

- [ ] **Step 6: Verify in a browser**

With `python -m http.server 8000` running in `code/`, drive it with Playwright:
answer a question and assert the card's bounding box stays inside the viewport
while `revealCount` climbs. This is the assertion whose absence let the bug ship.

Expected: card top ≥ 0 and bottom ≤ viewport height throughout; the future bars
visibly draw in.

- [ ] **Step 7: Commit**

```bash
git add project/tickread/code/
git commit -m "fix: reveal the answer where the player is looking"
```

---

## Task 4: The tape module

**Files:**
- Create: `src/tape.ts`
- Test: `tests/tape.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tape.test.ts`. Use a record factory so the tests stay readable:

```ts
import { test, equal, deepEqual } from "./harness.js";
import { tapeGlyphs, currentStreak, bestStreak } from "../src/tape.js";
import type { AnswerRecord, Direction } from "../src/types.js";

function record(given: Direction, correct: boolean): AnswerRecord {
  return {
    questionId: "q", assetClass: "equity", timeframe: "1d", horizon: 5,
    given, answer: correct ? given : given === "up" ? "down" : "up",
    correct, responseMs: 800,
    features: { tailTrend: 0, volumeSurge: false, realisedVol: 0.01 },
    ts: 0,
  };
}

test("tapeGlyphs is empty for no records", () => {
  deepEqual(tapeGlyphs([]), []);
});

test("tapeGlyphs carries the call and the outcome", () => {
  deepEqual(tapeGlyphs([record("up", true), record("down", false)]), [
    { call: "up", hit: true },
    { call: "down", hit: false },
  ]);
});

test("currentStreak counts consecutive hits at the end", () => {
  equal(currentStreak([record("up", true), record("up", true)]), 2);
});

test("currentStreak is 0 when the last answer missed", () => {
  equal(currentStreak([record("up", true), record("up", false)]), 0);
});

test("currentStreak is 0 for no records", () => {
  equal(currentStreak([]), 0);
});

test("bestStreak finds the longest run anywhere", () => {
  const records = [
    record("up", true), record("up", true), record("up", true),
    record("down", false),
    record("up", true),
  ];
  equal(bestStreak(records), 3);
});

test("bestStreak is 0 when nothing was ever right", () => {
  equal(bestStreak([record("up", false), record("down", false)]), 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -p .`
Expected: FAIL — `../src/tape.js` does not exist.

- [ ] **Step 3: Implement `src/tape.ts`**

```ts
/**
 * The tape: one glyph per answer. Shape carries the call, fill carries the
 * outcome, so the strip stays readable without colour. Pure, no DOM.
 */

import type { AnswerRecord, Direction } from "./types.js";

export interface TapeGlyph {
  call: Direction;
  hit: boolean;
}

export function tapeGlyphs(records: readonly AnswerRecord[]): TapeGlyph[] {
  return records.map((r) => ({ call: r.given, hit: r.correct }));
}

export function currentStreak(records: readonly AnswerRecord[]): number {
  let streak = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (!records[i]!.correct) break;
    streak++;
  }
  return streak;
}

export function bestStreak(records: readonly AnswerRecord[]): number {
  let best = 0;
  let run = 0;
  for (const r of records) {
    run = r.correct ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc -p . && node dist/tests/run.js`
Expected: PASS, seven tests added.

Register the new suite in `tests/run.ts` and `tests/index.html` alongside the others.

- [ ] **Step 5: Commit**

```bash
git add project/tickread/code/src/tape.ts project/tickread/code/tests/
git commit -m "feat: add the tape module"
```

---

## Task 5: Render the tape and the speed read-out

**Files:**
- Modify: `index.html`, `src/app.ts`, `style.css`

- [ ] **Step 1: Add the nodes**

In `index.html`, immediately inside `<main>` and before `#view-deck`'s head:

```html
<div id="tape-strip" class="tape" hidden>
  <div id="tape-glyphs" class="tape-glyphs"></div>
  <div id="tape-streak" class="tape-streak"></div>
</div>
```

Add a speed slot next to the verdict:

```html
<div id="verdict" class="verdict"></div>
<div id="speed" class="speed"></div>
```

Add `"tape-strip"`, `"tape-glyphs"`, `"tape-streak"` and `"speed"` to `REQUIRED_IDS`.

- [ ] **Step 2: Render the tape from `app.ts`**

```ts
const GLYPH: Record<string, string> = {
  "up-hit": "▲", "up-miss": "△", "down-hit": "▼", "down-miss": "▽",
};

function renderTape(): void {
  const records = state.session.records;
  const glyphs = tapeGlyphs(records);
  const total = state.session.questions.length;
  const cells = glyphs.map((g) => {
    const key = `${g.call}-${g.hit ? "hit" : "miss"}`;
    return `<span class="glyph glyph-${g.call} ${g.hit ? "hit" : "miss"}">${GLYPH[key]}</span>`;
  });
  if (glyphs.length < total) cells.push(`<span class="glyph cursor">▮</span>`);
  elements["tape-glyphs"]!.innerHTML = cells.join("");
  const streak = currentStreak(records);
  elements["tape-streak"]!.textContent = streak >= 2 ? `streak ${streak}` : "";
}
```

Call `renderTape()` from `showVerdict` (already wired in Task 3) and from
`startRound` once the session exists. Show `#tape-strip` when the deck view opens
and hide it elsewhere.

- [ ] **Step 3: Show the speed**

In `showVerdict`, after the verdict line:

```ts
elements["speed"]!.textContent = `${(record.responseMs / 1000).toFixed(1)}s`;
```

Clear it in `renderCard`.

- [ ] **Step 4: Style the tape**

```css
.tape {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-family: var(--font-data);
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.5rem;
  margin-bottom: 0.9rem;
}

.tape-glyphs { display: flex; gap: 0.34em; font-size: 1rem; line-height: 1; }
.glyph-up { color: var(--good); }
.glyph-down { color: var(--bad); }
.glyph.miss { opacity: 0.55; }
.glyph.cursor { color: var(--amber); animation: blink 1.1s steps(2, start) infinite; }
.tape-streak { font-size: 0.78rem; color: var(--amber); letter-spacing: 0.06em; }
.speed { font: 0.8rem/1 var(--font-data); color: var(--muted); text-align: center; min-height: 1rem; }

@keyframes blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .glyph.cursor { animation: none; }
}
```

- [ ] **Step 5: Verify in a browser**

Answer three questions with one deliberate miss. Expected: three glyphs, the miss
hollow, the cursor blinking after them, and the streak label clearing on the miss.

- [ ] **Step 6: Commit**

```bash
git add project/tickread/code/
git commit -m "feat: show the tape and the answer speed during a round"
```

---

## Task 6: Type, palette and layout

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Add the tokens**

Extend `:root` and the dark block. Keep `--good`, `--bad` and the `--viz-*` set
exactly as they are; the reasoning in the existing comment still holds.

```css
:root {
  --paper: #f7f5f1;
  --surface: #ffffff;
  --amber: #c97a21;
  --font-data: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Menlo, monospace;
  --font-prose: system-ui, -apple-system, "Segoe UI", sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #101114;
    --surface: #191b1f;
    --amber: #e9a542;
  }
}
```

Point the existing `--bg` at `--paper` and `--card` at `--surface` so nothing else
has to change name.

- [ ] **Step 2: Move data to the mono face**

```css
body { font: 16px/1.55 var(--font-prose); }

h1 {
  font-family: var(--font-data);
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.04em;
}

#card-meta, #progress, .tape, .speed, .stats, .num, .metric-value {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}

#card-meta { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; }
```

- [ ] **Step 3: Let the card fill the viewport**

```css
.card canvas {
  display: block;
  width: 100%;
  height: clamp(320px, 58vh, 620px);
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc -p . && node dist/tests/run.js`
Expected: PASS — no TypeScript touched, but the chart tests confirm nothing broke.

Screenshot the deck at 390×844 and at 1280×900. Expected: no horizontal scroll,
the chart dominating the frame in both.

- [ ] **Step 5: Commit**

```bash
git add project/tickread/code/style.css
git commit -m "feat: set market data in a monospace face and give the chart the viewport"
```

---

## Task 7: Emit `data/demo.json`

**Files:**
- Modify: `scripts/build_deck.py`
- Test: `scripts/test_pipeline.py`

- [ ] **Step 1: Write the failing test**

```python
def test_demo_selection_picks_four_distinct_questions(self):
    questions = [make_question(f"q{i}") for i in range(40)]
    demo = select_demo_questions(questions, count=4)
    self.assertEqual(len(demo), 4)
    self.assertEqual(len({q["id"] for q in demo}), 4)

def test_demo_selection_is_deterministic(self):
    questions = [make_question(f"q{i}") for i in range(40)]
    first = [q["id"] for q in select_demo_questions(questions, count=4)]
    second = [q["id"] for q in select_demo_questions(questions, count=4)]
    self.assertEqual(first, second)

def test_demo_selection_handles_a_short_bank(self):
    questions = [make_question("q0"), make_question("q1")]
    self.assertEqual(len(select_demo_questions(questions, count=4)), 2)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd scripts && python -m unittest test_pipeline`
Expected: FAIL — `select_demo_questions` is not defined.

- [ ] **Step 3: Implement**

Add to `build_deck.py` a `select_demo_questions(questions, count=4)` that sorts by
id for determinism and takes an even spread across the sorted list, then write the
result to `data/demo.json`:

```python
{"version": 1, "questions": [...]}
```

Each entry keeps the full `Question` shape — `id`, `assetClass`, `timeframe`,
`horizon`, `setup`, `future`, `answer` — so the browser can render it with no
special-casing.

- [ ] **Step 4: Verify**

Run: `cd scripts && python -m unittest test_pipeline`
Expected: PASS.

Run: `python build_deck.py` and confirm `data/demo.json` is written and under 100 KB.

- [ ] **Step 5: Commit**

```bash
git add project/tickread/code/scripts/ project/tickread/code/data/demo.json
git commit -m "feat: ship four demo questions for the landing page"
```

---

## Task 8: The demo module

**Files:**
- Create: `src/demo.ts`
- Test: `tests/demo.test.ts`

Cycle: `settle` 0–900ms (candles present, no motion), `poise` 900–1500ms (hand
fades in), `swipe` 1500–1900ms (card lifts), `reveal` 1900–2700ms (bars draw),
`rest` 2700–3600ms. `DEMO_CYCLE_MS` is 3600.

- [ ] **Step 1: Write the failing tests**

```ts
import { test, equal } from "./harness.js";
import { demoFrame, DEMO_CYCLE_MS } from "../src/demo.js";

test("the demo starts settled with nothing revealed", () => {
  const frame = demoFrame(0, 20);
  equal(frame.phase, "settle");
  equal(frame.revealCount, 0);
  equal(frame.cardOffset, 0);
  equal(frame.direction, null);
});

test("the card is at rest during settle and rest", () => {
  equal(demoFrame(500, 20).cardOffset, 0);
  equal(demoFrame(3000, 20).cardOffset, 0);
});

test("the card lifts during the swipe", () => {
  const frame = demoFrame(1700, 20);
  equal(frame.phase, "swipe");
  equal(frame.cardOffset < 0, true);
  equal(frame.direction, "up");
});

test("the reveal fills every bar by the end of its phase", () => {
  equal(demoFrame(2699, 20).revealCount > 0, true);
  equal(demoFrame(2700, 20).revealCount, 20);
});

test("the reveal never exceeds the bars given", () => {
  equal(demoFrame(2700, 5).revealCount, 5);
});

test("the cycle wraps", () => {
  equal(demoFrame(DEMO_CYCLE_MS, 20).phase, demoFrame(0, 20).phase);
  equal(demoFrame(DEMO_CYCLE_MS + 1700, 20).phase, demoFrame(1700, 20).phase);
});

test("the revealed bars stay revealed through rest", () => {
  equal(demoFrame(3200, 20).revealCount, 20);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc -p .`
Expected: FAIL — `../src/demo.js` does not exist.

- [ ] **Step 3: Implement `src/demo.ts`**

A pure function of `elapsedMs % DEMO_CYCLE_MS` returning the frame described in the
design. `cardOffset` is a fraction of card height, negative for up. Register the
suite in `tests/run.ts` and `tests/index.html`.

- [ ] **Step 4: Verify**

Run: `npx tsc -p . && node dist/tests/run.js`
Expected: PASS, seven tests added.

- [ ] **Step 5: Commit**

```bash
git add project/tickread/code/src/demo.ts project/tickread/code/tests/
git commit -m "feat: add the landing-page demo animation state"
```

---

## Task 9: The landing page

**Files:**
- Modify: `index.html`, `src/app.ts`, `style.css`

- [ ] **Step 1: Replace the start view's copy and add the demo card**

Cut the three explanatory paragraphs to one line. The demo shows the rest.

```html
<section id="view-start" class="view">
  <div id="demo-tape" class="tape tape-demo" hidden>
    <div id="demo-glyphs" class="tape-glyphs"></div>
  </div>
  <div id="demo-card" class="card card-demo" hidden>
    <canvas id="demo-canvas"></canvas>
    <div id="demo-hand" class="demo-hand">▲</div>
  </div>
  <p class="lede">Ten charts. No ticker, no dates. Swipe up if it went up.</p>
  <p id="start-summary" class="muted"></p>
  <button id="start-button" class="primary">Start</button>
</section>
```

Add the four new ids to `REQUIRED_IDS`.

- [ ] **Step 2: Load `demo.json` at boot**

```ts
async function loadDemo(): Promise<Question[]> {
  try {
    const response = await fetch(`${DATA_URL}/demo.json`);
    if (!response.ok) return [];
    const parsed = (await response.json()) as { questions: Question[] };
    return parsed.questions ?? [];
  } catch {
    // The demo is an enhancement. A landing page without it still starts a round.
    return [];
  }
}
```

- [ ] **Step 3: Drive the loop**

Start a `requestAnimationFrame` loop when the start view opens and the demo
questions loaded. Each frame: `demoFrame(now - loopStart, question.future.length)`,
paint the demo canvas with `renderChart(..., { revealCount })`, set
`demo-card`'s transform from `cardOffset * cardHeight`, set the hand's opacity.
Advance to the next demo question each time the cycle wraps. Stop the loop when
`state.view !== "start"` or `document.hidden`.

Under `prefers-reduced-motion`, paint one fully revealed frame and never schedule.

- [ ] **Step 4: Exclude the demo questions from real rounds**

```ts
const seen = new Set([...state.store.loadSeen(), ...state.demoQuestions.map((q) => q.id)]);
const questions = await buildRound(DATA_URL, { seen });
```

- [ ] **Step 5: Verify in a browser**

Load the landing page. Expected: the demo card draws candles, lifts, reveals its
future bars, and loops to a different chart; the demo tape fills with its calls;
the Start button works whether or not `demo.json` loaded.

- [ ] **Step 6: Commit**

```bash
git add project/tickread/code/
git commit -m "feat: play a real chart on the landing page"
```

---

## Task 10: Extend the integration check and finish

**Files:**
- Modify: `tests/integration.ts`

- [ ] **Step 1: Extend the element contract**

`integration.ts` already asserts `index.html` satisfies the ids `app.ts` requires.
Add the new ids and a check that `data/demo.json` parses, holds at least one
question, and that every demo id also appears in a shard.

- [ ] **Step 2: Run everything**

```bash
npx tsc -p . && node dist/tests/run.js
cd scripts && python -m unittest test_pipeline && cd ..
python -m http.server 8765 --bind 127.0.0.1 &
node dist/tests/integration.js
```

Expected: all three PASS.

- [ ] **Step 3: Drive the real app**

Play a full ten-question round in a browser. Expected: tape fills, streak appears
and breaks, every reveal is visible on screen, the report still renders.

- [ ] **Step 4: Commit and push**

```bash
git add project/tickread/code/tests/
git commit -m "test: cover the demo data and the new element contract"
git push origin master
```

- [ ] **Step 5: Verify the deploy**

Wait for the Pages run, then load the live site and play a round.

---

## Self-Review

**Spec coverage:** Reveal ordering → Task 3. Tape → Tasks 4, 5. Speed → Task 5.
Colour, type, layout → Task 6. Demo data → Task 7. Demo module → Task 8. Landing
page → Task 9. Report extraction → Task 1. Testing → Tasks 2, 4, 7, 8, 10.
Reduced motion → Tasks 3, 5, 9. Demo exclusion via `seen` → Task 9 Step 4.

**Type consistency:** `TapeGlyph { call, hit }` used identically in Tasks 4 and 5.
`RevealFrame { revealCount, done }` in Tasks 2 and 3. `DemoFrame.cardOffset`
normalised in Tasks 8 and 9. `revealTimeline`, `tapeGlyphs`, `currentStreak`,
`bestStreak`, `demoFrame`, `DEMO_CYCLE_MS`, `select_demo_questions` — each defined
once and referenced under the same name throughout.

**Known gap:** `bestStreak` is exported and tested but not yet rendered. It is the
natural figure for the report's round summary, which this pass does not touch. It
stays because the tape module is incomplete without it and the report will want it.
