/**
 * Entry point, and the only module that touches the DOM.
 *
 * Every other module is pure by design. This one absorbs all the impurity — DOM,
 * timers, requestAnimationFrame, localStorage construction, fetch kickoff — so that
 * none of it leaks into the logic that needs testing. The handful of decisions in
 * here that are worth testing are extracted as pure functions and exported.
 *
 * See specs/app.md.
 */

import { buildRound, DEFAULT_DECK_SIZE } from "./deck.js";
import { renderChart, DEFAULT_THEME } from "./chart.js";
import { renderReport } from "./report-view.js";
import { answer, createSession, currentQuestion, isFinished, progress } from "./session.js";
import { createHistoryStore, type HistoryStore } from "./storage.js";
import {
  ASSET_WORDS,
  TIMEFRAME_WORDS,
  type Direction,
  type Horizon,
  type Question,
  type SessionState,
} from "./types.js";

export type View = "start" | "deck" | "report" | "error";
export type ReportMode = "round" | "allTime";

const DATA_URL = "./data";
const COMMIT_FRACTION = 0.25;
const FLICK_VELOCITY = 0.5;
const REVEAL_MS = 600;
const HOLD_MS = 900;

// --- pure helpers, unit tested ------------------------------------------------

/** Which way a released drag commits, or null to spring back. */
export function shouldCommit(
  deltaY: number,
  cardHeight: number,
  velocity: number,
): Direction | null {
  if (cardHeight <= 0) return null;
  const farEnough = Math.abs(deltaY) > cardHeight * COMMIT_FRACTION;
  // A quick flick counts even when it is short, otherwise the gesture feels stuck.
  const fastEnough = Math.abs(velocity) > FLICK_VELOCITY && Math.abs(deltaY) > 8;
  if (!farEnough && !fastEnough) return null;
  return deltaY < 0 ? "up" : "down";
}


/**
 * The card's header line. States how far ahead the question looks, and never which
 * instrument or when — that is the anonymisation rule at the text layer.
 */
export function describeQuestion(question: Question): string {
  const horizon: Horizon = question.horizon;
  const ahead = horizon === 1 ? "next bar" : `next ${horizon} bars`;
  return `${TIMEFRAME_WORDS[question.timeframe]} · ${ASSET_WORDS[question.assetClass]} · ${ahead}`;
}

/**
 * The line shown after a swipe. States the answer, not only the score: "Wrong" on
 * its own leaves the user to work out what the right call was by squinting at the
 * candles that just animated in, which is exactly the moment the feedback should be
 * doing the work.
 *
 * The move is measured from the last setup close to the last future close — the same
 * pair the answer itself is graded on, and the same reference the chart's Y axis
 * uses. It is a percentage, so it says nothing about the instrument or the date.
 */
export function describeOutcome(question: Question, correct: boolean): string {
  const verdict = correct ? "Correct" : "Wrong";
  const reference = question.setup[question.setup.length - 1];
  const settled = question.future[question.future.length - 1];
  // A question with no future cannot happen in the shipped bank, but a verdict with
  // "NaN%" in it would be a worse failure than a verdict with no magnitude.
  if (!reference || !settled || reference.c === 0) return verdict;

  const move = Math.abs((settled.c / reference.c - 1) * 100);
  // The direction word carries the sign; "down -2.5%" would read as a rise.
  const word = question.answer === "up" ? "up" : "down";
  return `${verdict} — it went ${word} ${move.toFixed(1)}%`;
}


// --- DOM wiring ---------------------------------------------------------------

interface Elements {
  [id: string]: HTMLElement;
}

const REQUIRED_IDS = [
  "view-start", "view-deck", "view-report", "view-error",
  "start-button", "card", "chart-canvas", "card-meta", "progress",
  "verdict", "report-body", "report-mode", "restart-button", "error-message",
  "start-summary", "error-retry",
];

function resolveElements(): Elements {
  const found: Elements = {};
  for (const id of REQUIRED_IDS) {
    const element = document.getElementById(id);
    // A missing element is a build error, not a runtime condition. Failing loudly
    // beats degrading into a half-working page.
    if (!element) throw new Error(`tickread: index.html is missing #${id}`);
    found[id] = element;
  }
  return found;
}

interface AppState {
  view: View;
  session: SessionState;
  store: HistoryStore;
  shownAt: number;
  busy: boolean;
  reportMode: ReportMode;
}

export function main(): void {
  const elements = resolveElements();

  const state: AppState = {
    view: "start",
    session: createSession([]),
    store: createHistoryStore(),
    shownAt: 0,
    busy: false,
    reportMode: "allTime",
  };

  const canvas = elements["chart-canvas"] as HTMLCanvasElement;
  const card = elements["card"]!;

  function show(view: View): void {
    state.view = view;
    for (const name of ["start", "deck", "report", "error"] as const) {
      elements[`view-${name}`]!.hidden = name !== view;
    }
  }

  function fail(message: string): void {
    elements["error-message"]!.textContent = message;
    show("error");
  }

  function paint(revealCount: number): void {
    const question = currentQuestion(state.session);
    if (!question) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width || canvas.clientWidth;
    const height = rect.height || canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderChart(ctx, question.setup, question.future, {
      width, height, dpr, revealCount, theme: DEFAULT_THEME,
    });
  }

  function renderCard(): void {
    const question = currentQuestion(state.session);
    if (!question) return;
    card.style.transform = "";
    card.classList.remove("tint-up", "tint-down");
    elements["verdict"]!.textContent = "";
    elements["verdict"]!.className = "verdict";
    elements["card-meta"]!.textContent = describeQuestion(question);
    const { answered, total } = progress(state.session);
    elements["progress"]!.textContent = `${answered + 1} / ${total}`;
    paint(0);
    state.shownAt = performance.now();
    state.busy = false;
  }

  function finishRound(): void {
    state.store.appendRecords(state.session.records);
    const history = state.store.loadHistory();
    state.reportMode = history.length > state.session.records.length ? "allTime" : "round";
    renderReportForMode();
    show("report");
  }

  function renderReportForMode(): void {
    const records =
      state.reportMode === "round" ? state.session.records : state.store.loadHistory();
    renderReport(elements["report-body"]!, records);
    for (const button of elements["report-mode"]!.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset["mode"] === state.reportMode);
    }
  }

  function reveal(given: Direction): void {
    const question = currentQuestion(state.session)!;
    const responseMs = performance.now() - state.shownAt;
    state.session = answer(state.session, given, responseMs);
    const record = state.session.records[state.session.records.length - 1]!;

    const verdict = elements["verdict"]!;
    verdict.textContent = describeOutcome(question, record.correct);
    verdict.className = `verdict ${record.correct ? "good" : "bad"}`;

    const steps = question.future.length;
    const started = performance.now();
    const step = (): void => {
      const ratio = Math.min(1, (performance.now() - started) / REVEAL_MS);
      paint(Math.max(1, Math.round(ratio * steps)));
      if (ratio < 1) {
        requestAnimationFrame(step);
        return;
      }
      window.setTimeout(() => {
        if (isFinished(state.session)) finishRound();
        else renderCard();
      }, HOLD_MS);
    };
    requestAnimationFrame(step);
  }

  function commit(given: Direction): void {
    if (state.busy || state.view !== "deck" || isFinished(state.session)) return;
    state.busy = true;
    card.style.transform = `translateY(${given === "up" ? -140 : 140}%)`;
    reveal(given);
  }

  // --- gesture ---
  let dragging = false;
  let originY = 0;
  let originT = 0;
  let deltaY = 0;

  card.addEventListener("pointerdown", (event) => {
    if (state.busy) return;
    dragging = true;
    originY = event.clientY;
    originT = performance.now();
    deltaY = 0;
    card.setPointerCapture(event.pointerId);
    card.classList.add("dragging");
  });

  card.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    deltaY = event.clientY - originY;
    card.style.transform = `translateY(${deltaY}px)`;
    card.classList.toggle("tint-up", deltaY < -12);
    card.classList.toggle("tint-down", deltaY > 12);
  });

  function release(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("dragging");
    try {
      card.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone; nothing to release.
    }
    const velocity = deltaY / Math.max(1, performance.now() - originT);
    const decision = shouldCommit(deltaY, card.getBoundingClientRect().height, velocity);
    if (decision) {
      commit(decision);
    } else {
      card.style.transform = "";
      card.classList.remove("tint-up", "tint-down");
    }
  }

  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);

  document.addEventListener("keydown", (event) => {
    if (state.view !== "deck") return;
    if (event.key === "ArrowUp") commit("up");
    if (event.key === "ArrowDown") commit("down");
  });

  // --- round lifecycle ---
  async function startRound(): Promise<void> {
    const button = elements["start-button"] as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Loading charts…";
    try {
      const questions = await buildRound(DATA_URL, { seen: state.store.loadSeen() });
      if (questions.length === 0) {
        fail("The question bank is empty. Rebuild it with scripts/build_deck.py.");
        return;
      }
      state.store.markSeen(questions.map((q) => q.id));
      state.session = createSession(questions);
      show("deck");
      renderCard();
    } catch (error) {
      fail(
        `Could not load the question bank. ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      button.disabled = false;
      button.textContent = "Start";
    }
  }

  elements["start-button"]!.addEventListener("click", () => void startRound());
  elements["error-retry"]!.addEventListener("click", () => void startRound());
  elements["restart-button"]!.addEventListener("click", () => {
    show("start");
    renderStartSummary();
  });

  elements["report-mode"]!.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const mode = target.dataset["mode"];
    if (mode === "round" || mode === "allTime") {
      state.reportMode = mode;
      renderReportForMode();
    }
  });

  window.addEventListener("resize", () => {
    if (state.view === "deck" && !state.busy) paint(0);
  });

  function renderStartSummary(): void {
    const history = state.store.loadHistory();
    if (history.length === 0) {
      elements["start-summary"]!.textContent = "";
      return;
    }
    const correct = history.filter((r) => r.correct).length;
    const rounds = Math.round(history.length / DEFAULT_DECK_SIZE);
    elements["start-summary"]!.textContent =
      `${history.length} answers so far (about ${rounds} rounds) · ` +
      `${((correct / history.length) * 100).toFixed(0)}% correct`;
  }

  renderStartSummary();
  show("start");
}
