type Direction = "up" | "down";
type Bar = { o: number; h: number; l: number; c: number; v: number };
type Question = {
  id: string;
  assetClass: string;
  timeframe: string;
  horizon: number;
  symbol: string;
  startTime: number;
  endTime: number;
  setup: Bar[];
  future: Bar[];
  answer: Direction;
};
type Shard = { file: string };
type Manifest = { version: number; shards: Shard[] };
type SessionRecord = {
  schemaVersion: 1;
  questionId: string;
  given: Direction;
  answer: Direction;
  correct: boolean;
  responseMs: number;
  answeredAt: string;
};

const ROUND_SIZE = 10;
const STORAGE_KEY = "tickread-mobile.records.v1";
const SWIPE_THRESHOLD = 56;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

const home = byId<HTMLElement>("home-screen");
const game = byId<HTMLElement>("game-screen");
const report = byId<HTMLElement>("report-screen");
const chart = byId<HTMLCanvasElement>("chart");
const result = byId<HTMLElement>("result");
const lifetime = byId<HTMLElement>("lifetime");
const meta = byId<HTMLElement>("meta");
const counter = byId<HTMLElement>("counter");
const streak = byId<HTMLElement>("streak");
const next = byId<HTMLButtonElement>("next-button");
const actions = byId<HTMLElement>("actions");
const reportList = byId<HTMLElement>("report-list");

let deck: Question[] = [];
let records: SessionRecord[] = [];
let index = 0;
let started = 0;
let pointerY: number | null = null;

function isBar(value: unknown): value is Bar {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Bar>;
  return [b.o, b.h, b.l, b.c, b.v].every((n) => typeof n === "number");
}

// Only validates public fields. Reveal-only fields (answer, future, symbol,
// startTime, endTime) are intentionally not accessed here — the contract
// requires they remain unread until the user's direction is recorded.
function isQuestion(value: unknown): value is Question {
  if (!value || typeof value !== "object") return false;
  const q = value as Partial<Question>;
  return (
    typeof q.id === "string" &&
    typeof q.assetClass === "string" &&
    typeof q.timeframe === "string" &&
    typeof q.horizon === "number" &&
    Array.isArray(q.setup) &&
    q.setup.length > 0 &&
    q.setup.every(isBar)
  );
}

async function loadRound(): Promise<Question[]> {
  const base = "../tickread/code/data";
  const manifest = (await (await fetch(`${base}/manifest.json`)).json()) as Manifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.shards)) {
    throw new Error("Question bank is unavailable.");
  }
  const pages = await Promise.all(
    manifest.shards.map(async ({ file }) =>
      (await (await fetch(`${base}/${file}`)).json()) as unknown[]
    )
  );
  const pool = pages.flat().filter(isQuestion);
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, ROUND_SIZE);
}

function stored(): SessionRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v): v is SessionRecord => !!v && typeof v === "object")
      : [];
  } catch {
    return [];
  }
}

function updateLifetime(): void {
  const all = stored();
  lifetime.textContent = all.length
    ? `${Math.round((all.filter((r) => r.correct).length / all.length) * 100)}% lifetime hit rate · ${all.length} calls`
    : "No history yet";
}

function show(screen: HTMLElement): void {
  for (const item of [home, game, report]) item.hidden = item !== screen;
}

function current(): Question {
  const q = deck[index];
  if (!q) throw new Error("No active question");
  return q;
}

function draw(question: Question, revealed: readonly Bar[] = []): void {
  const rect = chart.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  chart.width = width * dpr;
  chart.height = height * dpr;
  const ctx = chart.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const bars = [...question.setup, ...revealed];
  const values = bars.flatMap((b) => [b.h, b.l]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const step = width / (question.setup.length + question.horizon);
  const y = (v: number) => height - 24 - ((v - low) / range) * (height - 48);

  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "#3d4541";
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(question.setup.length * step, 0);
  ctx.lineTo(question.setup.length * step, height);
  ctx.stroke();
  ctx.setLineDash([]);

  bars.forEach((b, i) => {
    const up = b.c >= b.o;
    ctx.strokeStyle = ctx.fillStyle = up ? "#62c998" : "#ec727b";
    ctx.globalAlpha = i < question.setup.length ? 1 : 0.55;
    const x = i * step + step * 0.15;
    const w = Math.max(2, step * 0.7);
    ctx.fillRect(x, Math.min(y(b.o), y(b.c)), w, Math.max(2, Math.abs(y(b.c) - y(b.o))));
    ctx.fillRect(x + w * 0.45, y(b.h), Math.max(1, w * 0.12), Math.max(1, y(b.l) - y(b.h)));
  });
  ctx.globalAlpha = 1;
}

function renderQuestion(): void {
  const q = current();
  started = performance.now();
  // Only public fields accessed here — no reveal-only fields.
  meta.textContent = `${q.timeframe.toUpperCase()} · ${q.assetClass.replace("_", " ").toUpperCase()} · NEXT ${q.horizon} BARS`;
  counter.textContent = `${index + 1} / ${deck.length}`;
  let run = 0;
  for (const r of records) {
    run = r.correct ? run + 1 : 0;
  }
  streak.textContent = `Streak ${run}`;
  result.hidden = true;
  next.hidden = true;
  actions.hidden = false;
  draw(q);
}

function movePercent(q: Question): number {
  // Accesses q.future — only called after the user has answered.
  return (q.future[q.future.length - 1]!.c / q.setup[q.setup.length - 1]!.c - 1) * 100;
}

function answer(given: Direction): void {
  if (actions.hidden) return;
  const q = current();
  // q.answer is a reveal-only field. It is first accessed here, after the
  // user has committed their direction by calling this function.
  const correctAnswer = q.answer;
  const record: SessionRecord = {
    schemaVersion: 1,
    questionId: q.id,
    given,
    answer: correctAnswer,
    correct: given === correctAnswer,
    responseMs: Math.round(performance.now() - started),
    answeredAt: new Date().toISOString(),
  };
  records.push(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...stored(), record]));
  actions.hidden = true;
  animateReveal(q, record);
}

function animateReveal(q: Question, r: SessionRecord): void {
  let i = 0;
  const timer = window.setInterval(() => {
    i++;
    // q.future accessed here — direction is already recorded above.
    draw(q, q.future.slice(0, i));
    if (i >= q.future.length) {
      clearInterval(timer);
      const move = movePercent(q);
      // q.startTime, q.endTime, q.symbol accessed here — reveal-only, post-answer.
      const range = `${new Date(q.startTime * 1000).toLocaleDateString()} – ${new Date(q.endTime * 1000).toLocaleDateString()}`;
      result.className = `result ${r.correct ? "good" : "bad"}`;
      result.innerHTML = `<strong>${r.correct ? "Correct" : "Not quite"} — price ${move >= 0 ? "rose" : "fell"} ${Math.abs(move).toFixed(1)}%</strong><br>${q.symbol} · ${q.timeframe} · ${range}<br>Your call: ${r.given === "up" ? "Bullish" : "Bearish"} · ${(r.responseMs / 1000).toFixed(1)} s`;
      result.hidden = false;
      next.textContent = index === deck.length - 1 ? "View round report" : "Next question";
      window.setTimeout(() => (next.hidden = false), 2200);
    }
  }, 260);
}

function showReport(): void {
  const correct = records.filter((r) => r.correct).length;
  const longest = records.reduce(
    (acc, r) => ({
      run: r.correct ? acc.run + 1 : 0,
      best: Math.max(acc.best, r.correct ? acc.run + 1 : 0),
    }),
    { run: 0, best: 0 }
  ).best;
  byId<HTMLElement>("report-title").textContent = `${Math.round((correct / records.length) * 100)}% hit rate`;
  byId<HTMLElement>("report-streak").textContent = `Longest streak: ${longest}`;
  reportList.innerHTML = "";
  records.forEach((r, i) => {
    const q = deck[i]!;
    const row = document.createElement("div");
    row.className = `report-row ${r.correct ? "good" : "bad"}`;
    // q.symbol and q.future (via movePercent) accessed post-round — all answers recorded.
    row.textContent = `${r.correct ? "✓" : "×"} ${q.symbol} · ${movePercent(q).toFixed(1)}%`;
    reportList.append(row);
  });
  updateLifetime();
  show(report);
}

// --- event wiring ---

byId<HTMLButtonElement>("start-button").addEventListener("click", async () => {
  try {
    deck = await loadRound();
    if (deck.length < ROUND_SIZE) throw new Error("Not enough questions");
    records = [];
    index = 0;
    show(game);
    renderQuestion();
  } catch (error) {
    lifetime.textContent =
      error instanceof Error ? error.message : "Could not load question bank";
  }
});

byId<HTMLButtonElement>("up-button").addEventListener("click", () => answer("up"));
byId<HTMLButtonElement>("down-button").addEventListener("click", () => answer("down"));

next.addEventListener("click", () => {
  if (index === deck.length - 1) showReport();
  else {
    index++;
    renderQuestion();
  }
});

chart.addEventListener("pointerdown", (e) => {
  pointerY = e.clientY;
  chart.setPointerCapture(e.pointerId);
});

chart.addEventListener("pointerup", (e) => {
  if (pointerY === null) return;
  const d = e.clientY - pointerY;
  pointerY = null;
  if (Math.abs(d) >= SWIPE_THRESHOLD) answer(d < 0 ? "up" : "down");
});

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") answer("up");
  if (e.key === "ArrowDown") answer("down");
});

byId<HTMLButtonElement>("again-button").addEventListener("click", () =>
  byId<HTMLButtonElement>("start-button").click()
);

byId<HTMLButtonElement>("home-button").addEventListener("click", () => {
  updateLifetime();
  show(home);
});

updateLifetime();
