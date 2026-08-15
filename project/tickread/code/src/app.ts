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
import { currentStreak } from "./streak.js";
import { demoFrame, DEMO_CYCLE_MS } from "./demo.js";
import { burstSparks, liveSparks, makeSpark, sparkFrame, type Spark } from "./spark.js";
import { answer, createSession, currentQuestion, isFinished, progress } from "./session.js";
import { createHistoryStore, type HistoryStore } from "./storage.js";
import {
  ASSET_WORDS,
  TIMEFRAME_WORDS,
  type AnswerRecord,
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
/** Roughly how long one future bar takes to draw itself in. */
const PER_BAR_MS = 46;
/** Short enough to stay a reveal, long enough that a single bar is watchable. */
export const MIN_REVEAL_MS = 380;
/** Past this the reveal stops being feedback and becomes a wait. */
export const MAX_REVEAL_MS = 920;
/** The beat after they have all landed, so the shape can actually be read. */
export const HOLD_MS = 900;
/** Cross-fade to the next chart, rather than snapping to it. */
const SWAP_MS = 150;

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


export interface RevealFrame {
  /**
   * Bars of the future to draw, and deliberately not an integer: the whole part is
   * the bars that have fully arrived, the fraction is how far the next one has got.
   */
  revealCount: number;
  /** True once every bar has landed and the hold has elapsed. */
  done: boolean;
}

/**
 * How long a reveal of `steps` bars should take.
 *
 * A fixed budget cut into however many bars the question has does not work, because
 * the shipped horizons are 1, 5 and 20 — a 20× spread. One budget makes twenty bars
 * a blur and one bar an instant. Time per bar, clamped at both ends, gives all three
 * horizons the same cadence and keeps the extremes watchable.
 */
export function revealDurationMs(steps: number): number {
  if (steps <= 0) return MIN_REVEAL_MS;
  return Math.min(MAX_REVEAL_MS, Math.max(MIN_REVEAL_MS, steps * PER_BAR_MS));
}

/**
 * Where the reveal has got to at `elapsedMs`.
 *
 * Pure, and exported, for the same reason `shouldCommit` is: this is the sequencing
 * that used to run against a card already thrown off screen, so it is worth being
 * able to assert on without a browser.
 *
 * The count is continuous. It used to be `Math.max(1, round(...))`, which forced the
 * first bar fully on at the first frame — so a one-bar horizon had exactly two states,
 * absent and finished, and never appeared to animate at all. A fraction gives the
 * renderer a bar caught mid-formation to draw, which is what makes 1, 5 and 20 bars
 * read as the same gesture at different lengths.
 */
export function revealTimeline(elapsedMs: number, steps: number): RevealFrame {
  const duration = revealDurationMs(steps);
  if (steps <= 0) return { revealCount: 0, done: elapsedMs >= duration + HOLD_MS };
  if (elapsedMs <= 0) return { revealCount: 0, done: false };
  const ratio = Math.min(1, elapsedMs / duration);
  // Ease out, so the run of bars decelerates into the last one — which is the bar
  // the answer is graded on, and the one worth landing on rather than skidding past.
  const eased = 1 - (1 - ratio) * (1 - ratio);
  return {
    revealCount: Math.min(steps, eased * steps),
    done: elapsedMs >= duration + HOLD_MS,
  };
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

/** Identifies the chart only after its outcome has been revealed. */
function describeRevealDetails(question: Question): string {
  const formatDate = (timestamp: number | undefined): string => {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      return "date unavailable";
    }
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(timestamp * 1000));
  };
  const symbol = question.symbol ?? "Instrument unavailable";
  return `${symbol} | ${TIMEFRAME_WORDS[question.timeframe]} chart | ` +
    `${formatDate(question.startTime)} - ${formatDate(question.endTime)}`;
}

/**
 * The line a returning player reads first, on the landing page.
 *
 * Rounds are whole by construction — records are only ever appended a finished round
 * at a time — so "about" is a hedge against a number that is not actually uncertain,
 * and is dropped when the division comes out exact. The plural is computed rather
 * than assumed, because the very first thing a new player saw was "about 1 rounds".
 */
export function describeHistory(answers: number, deckSize: number): string {
  if (answers <= 0) return "";
  const exact = deckSize > 0 ? answers / deckSize : 0;
  const rounds = Math.max(1, Math.round(exact));
  const word = rounds === 1 ? "round" : "rounds";
  const counted = Number.isInteger(exact) ? `${rounds} ${word}` : `about ${rounds} ${word}`;
  return `${answers} ${answers === 1 ? "answer" : "answers"} so far (${counted})`;
}

// --- DOM wiring ---------------------------------------------------------------

interface Elements {
  [id: string]: HTMLElement;
}

const REQUIRED_IDS = [
  "view-start", "view-deck", "view-report", "view-error",
  "start-button", "card", "chart-canvas", "card-meta", "progress",
  "verdict", "report-body", "report-mode", "restart-button", "error-message",
  "start-summary", "error-retry", "call-announce", "spark-canvas",
  "streak", "speed",
  "demo-card", "demo-canvas", "demo-hand",
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
  /** The four questions the landing page plays. Empty if demo.json did not load. */
  demoQuestions: Question[];
}

/**
 * The landing page's four questions. An enhancement, never a gate: if this fails
 * the page renders without the demo card and Start still works.
 */
async function loadDemoQuestions(): Promise<Question[]> {
  try {
    const response = await fetch(`${DATA_URL}/demo.json`);
    if (!response.ok) return [];
    const parsed = (await response.json()) as { questions?: Question[] };
    return parsed.questions ?? [];
  } catch {
    return [];
  }
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
    demoQuestions: [],
  };

  const canvas = elements["chart-canvas"] as HTMLCanvasElement;
  const card = elements["card"]!;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  /**
   * Draws `question`, which is passed in rather than read from the session on purpose.
   *
   * This used to call `currentQuestion(state.session)` itself, and `answer()` advances
   * the index — so every frame of the reveal painted the *next* question's chart while
   * the header still described the one just answered. The player watched a future
   * belonging to a chart they had never seen, and on the last card of a round
   * `currentQuestion` returned null and nothing was painted at all. It also explains
   * why the reveal seemed to work only sometimes: `revealCount` was counting the
   * answered question's bars into a chart with a different number of them, so the
   * clamp in `renderChart` cut the animation short by however much the two differed.
   */
  function paint(question: Question, revealCount: number): void {
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
    card.classList.remove("tint-up", "tint-down", "called-up", "called-down", "popping");
    elements["call-announce"]!.textContent = "";
    elements["verdict"]!.textContent = "";
    elements["verdict"]!.className = "verdict";
    elements["speed"]!.textContent = "";
    elements["card-meta"]!.textContent = describeQuestion(question);
    const { answered, total } = progress(state.session);
    elements["progress"]!.textContent = `${answered + 1} / ${total}`;
    paint(question, 0);
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

  /**
   * The live streak. Deliberately the only running performance signal in a round:
   * it says how many in a row, and nothing about which way they were called, so it
   * cannot nudge the player's next answer in either direction.
   */
  function renderStreak(): void {
    const streak = currentStreak(state.session.records);
    // One hit is not a streak; saying so every time would make the word worthless.
    elements["streak"]!.textContent = streak >= 2 ? `streak ${streak}` : "";
  }

  /**
   * The verdict lands with the last bar, not with the swipe. Showing it up front
   * would answer the question before the chart has finished answering it.
   */
  function showVerdict(question: Question, record: AnswerRecord): void {
    const verdict = elements["verdict"]!;
    verdict.replaceChildren(
      document.createTextNode(describeOutcome(question, record.correct)),
      Object.assign(document.createElement("span"), {
        className: "verdict-details",
        textContent: describeRevealDetails(question),
      }),
    );
    verdict.className = `verdict ${record.correct ? "good" : "bad"}`;
    // Already recorded on every answer since the first release, and never shown.
    elements["speed"]!.textContent = `${(record.responseMs / 1000).toFixed(1)}s`;
    renderStreak();
  }

  /** Cross-fade to the next chart. Snapping between two charts reads as a glitch. */
  function advanceCard(): void {
    card.classList.add("swapping");
    window.setTimeout(() => {
      renderCard();
      card.classList.remove("swapping");
    }, SWAP_MS);
  }

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
      paint(question, frame.revealCount);
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

  // --- the sparkle trail ---
  //
  // A swipe used to be acknowledged by a chip reading "▲ YOU SAID UP". Sparks say the
  // same thing while the gesture is still under way, in the direction it is going,
  // without asking anyone to read anything. `spark.ts` owns the model; this owns the
  // canvas, the clock and the pointer.

  const sparkCanvas = elements["spark-canvas"] as HTMLCanvasElement;
  /** Dense enough to read as a trail, sparse enough not to be a smear. */
  const TRAIL_EVERY_MS = 28;
  let sparks: Spark[] = [];
  let sparkLoopRunning = false;
  let lastTrailAt = 0;

  /** A four-point sparkle: long spikes and a pinched waist, the magic-wand kind. */
  function starPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    angle: number,
  ): void {
    const waist = radius * 0.26;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = angle + (i * Math.PI) / 4;
      const r = i % 2 === 0 ? radius : waist;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function paintSparks(now: number): void {
    const rect = sparkCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    sparkCanvas.width = Math.round(rect.width * dpr);
    sparkCanvas.height = Math.round(rect.height * dpr);
    const ctx = sparkCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    // Sizes are a fraction of the shorter side, so a star is a star on any screen.
    const unit = Math.min(rect.width, rect.height);
    for (const spark of sparks) {
      const frame = sparkFrame(spark, now);
      if (!frame) continue;
      ctx.globalAlpha = frame.alpha;
      ctx.fillStyle = frame.tint;
      // The bloom is what sells it as light rather than as a small yellow polygon.
      ctx.shadowColor = frame.tint;
      ctx.shadowBlur = frame.size * unit * 1.4;
      starPath(ctx, frame.x * rect.width, frame.y * rect.height, frame.size * unit, frame.angle);
      ctx.fill();
    }
    ctx.restore();
  }

  function sparkStep(): void {
    const now = performance.now();
    sparks = liveSparks(sparks, now);
    paintSparks(now);
    if (sparks.length === 0 && !dragging) {
      sparkLoopRunning = false;
      const ctx = sparkCanvas.getContext("2d");
      ctx?.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
      return;
    }
    requestAnimationFrame(sparkStep);
  }

  function runSparks(): void {
    if (sparkLoopRunning) return;
    sparkLoopRunning = true;
    requestAnimationFrame(sparkStep);
  }

  /** Pointer position as a fraction of the spark canvas, which is what a spark wants. */
  function sparkPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = sparkCanvas.getBoundingClientRect();
    return {
      x: rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5,
      y: rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5,
    };
  }

  /** One or two stars off the fingertip, rate limited so a fast drag cannot flood. */
  function trailSparks(clientX: number, clientY: number, given: Direction): void {
    if (reducedMotion) return;
    const now = performance.now();
    if (now - lastTrailAt < TRAIL_EVERY_MS) return;
    lastTrailAt = now;
    const { x, y } = sparkPoint(clientX, clientY);
    sparks.push(makeSpark({ x, y, direction: given, now, random: Math.random }));
    runSparks();
  }

  function burstAt(clientX: number, clientY: number, given: Direction): void {
    if (reducedMotion) return;
    const { x, y } = sparkPoint(clientX, clientY);
    sparks.push(
      ...burstSparks({ x, y, direction: given, now: performance.now(), random: Math.random }),
    );
    runSparks();
  }

  /** Where the gesture let go of the card, for the animation to pick up from. */
  interface Release {
    x: number;
    y: number;
    offsetY: number;
  }

  /** How far past rest the card carries before settling. */
  const POP_OVERSHOOT = 8;
  /** A keyboard call has no drag to continue, so it gets a nudge of its own. */
  const POP_NUDGE = 15;

  function commit(given: Direction, release?: Release): void {
    if (state.busy || state.view !== "deck" || isFinished(state.session)) return;
    state.busy = true;

    // The card stays where the player is looking. Throwing it off screen here is
    // exactly what hid the reveal: the true future bars paint into *this* canvas,
    // and for as long as this line read `translateY(±140%)` they painted into a
    // card that had already left the viewport.
    card.style.transform = "";
    card.classList.remove("tint-up", "tint-down");

    // Coloured by the call, never by the outcome — the outcome is what the reveal
    // is for, and tinting it now would give the answer away.
    card.classList.add(given === "up" ? "called-up" : "called-down");

    // Hand the animation both ends. A drag continues from wherever it let go and
    // overshoots slightly past rest; a keypress starts at rest and gets the nudge
    // instead, so both inputs produce the same gesture.
    const away = given === "up" ? -1 : 1;
    const from = release?.offsetY ?? 0;
    card.style.setProperty("--pop-from", `${from}px`);
    card.style.setProperty(
      "--pop-back",
      `${from === 0 ? away * POP_NUDGE : -away * POP_OVERSHOOT}px`,
    );
    // Restarting the animation needs the class off for a reflow, or a second call
    // is a no-op as far as the animation is concerned.
    card.classList.remove("popping");
    void card.offsetWidth;
    card.classList.add("popping");

    // Announced, never printed: the screen says it with colour and motion.
    elements["call-announce"]!.textContent = given === "up" ? "Called up." : "Called down.";

    const rect = card.getBoundingClientRect();
    burstAt(
      release?.x ?? rect.left + rect.width / 2,
      release?.y ?? rect.top + rect.height / 2,
      given,
    );

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
    // Only once the drag has a direction worth committing to. Sparks flying off a
    // 3px twitch would make the effect meaningless.
    if (Math.abs(deltaY) > 12) {
      trailSparks(event.clientX, event.clientY, deltaY < 0 ? "up" : "down");
    }
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
      commit(decision, { x: event.clientX, y: event.clientY, offsetY: deltaY });
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
      // The demo questions have had their answers played out on the landing page,
      // so dealing one would be asking something already given away. The seen set
      // buildRound already accepts is exactly the right mechanism.
      const seen = new Set([
        ...state.store.loadSeen(),
        ...state.demoQuestions.map((q) => q.id),
      ]);
      const questions = await buildRound(DATA_URL, { seen });
      if (questions.length === 0) {
        // Only reachable from a broken build, so the instruction goes where the
        // person who can act on it will see it.
        console.error("tickread: the question bank is empty — rebuild with scripts/build_deck.py");
        fail("There are no charts to play right now. Please try again later.");
        return;
      }
      state.store.markSeen(questions.map((q) => q.id));
      state.session = createSession(questions);
      show("deck");
      // Clears any streak left over from the previous round.
      renderStreak();
      renderCard();
    } catch (error) {
      // The raw reason goes to the console, not to the page. "Failed to fetch" is the
      // browser talking to a developer; it tells a player nothing they can act on,
      // and it is still one keystroke away for whoever is debugging a deploy.
      console.error("tickread: could not load the question bank", error);
      fail("Could not load the charts. Check your connection, then try again.");
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
    if (!reducedMotion) startDemo();
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
    if (state.view !== "deck" || state.busy) return;
    // Only between cards. Mid-reveal this would repaint at revealCount 0 and undo it.
    const question = currentQuestion(state.session);
    if (question) paint(question, 0);
  });

  function renderStartSummary(): void {
    const history = state.store.loadHistory();
    if (history.length === 0) {
      elements["start-summary"]!.textContent = "";
      return;
    }
    const correct = history.filter((r) => r.correct).length;
    elements["start-summary"]!.textContent =
      `${describeHistory(history.length, DEFAULT_DECK_SIZE)} · ` +
      `${((correct / history.length) * 100).toFixed(0)}% correct`;
  }

  // --- the landing page demo ---

  const demoCanvas = elements["demo-canvas"] as HTMLCanvasElement;
  const demoCard = elements["demo-card"]!;
  const demoHand = elements["demo-hand"]!;

  let demoIndex = 0;
  let demoStartedAt = 0;
  let demoRunning = false;

  function paintDemo(question: Question, revealCount: number): void {
    const rect = demoCanvas.getBoundingClientRect();
    const width = rect.width || demoCanvas.clientWidth;
    const height = rect.height || demoCanvas.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    demoCanvas.width = Math.round(width * dpr);
    demoCanvas.height = Math.round(height * dpr);
    const ctx = demoCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, demoCanvas.width, demoCanvas.height);
    renderChart(ctx, question.setup, question.future, {
      width, height, dpr, revealCount, theme: DEFAULT_THEME,
    });
  }

  function demoStep(): void {
    if (!demoRunning) return;
    if (state.view !== "start" || document.hidden) {
      demoRunning = false;
      return;
    }
    const question = state.demoQuestions[demoIndex % state.demoQuestions.length]!;
    const elapsed = performance.now() - demoStartedAt;

    if (elapsed >= DEMO_CYCLE_MS) {
      demoIndex++;
      demoStartedAt = performance.now();
      requestAnimationFrame(demoStep);
      return;
    }

    const frame = demoFrame(elapsed, question.future.length);
    paintDemo(question, frame.revealCount);
    const lift = frame.cardOffset * demoCard.getBoundingClientRect().height;
    demoCard.style.transform = lift === 0 ? "" : `translateY(${lift.toFixed(1)}px)`;
    demoHand.style.opacity = String(frame.handOpacity);
    requestAnimationFrame(demoStep);
  }

  function startDemo(): void {
    if (state.demoQuestions.length === 0 || demoRunning) return;
    if (state.view !== "start") return;
    demoRunning = true;
    demoStartedAt = performance.now();
    requestAnimationFrame(demoStep);
  }

  function showDemo(): void {
    if (state.demoQuestions.length === 0) return;
    elements["demo-card"]!.hidden = false;

    if (reducedMotion) {
      // One fully revealed chart, never animated. The point still lands: this is
      // what a question looks like and this is what the answer looks like.
      const question = state.demoQuestions[0]!;
      demoHand.style.opacity = "0";
      paintDemo(question, question.future.length);
      return;
    }
    startDemo();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) demoRunning = false;
    else if (!reducedMotion) startDemo();
  });

  renderStartSummary();
  show("start");

  void loadDemoQuestions().then((questions) => {
    state.demoQuestions = questions;
    if (state.view === "start") showDemo();
  });
}
