type Direction = "up" | "down";
type SessionRecord = {
  schemaVersion: 1;
  questionId: string;
  given: Direction;
  answer: Direction;
  correct: boolean;
  responseMs: number;
  answeredAt: string;
};
type QuestionMeta = { id: string; assetClass: string; timeframe: string; horizon: number };
type Manifest = { version: number; shards: { file: string }[] };

const STORAGE_KEY = "tickread-mobile.records.v1";
const GROUP_MINIMUM = 20;
const STYLE_MINIMUM = 30;

function isDirection(value: unknown): value is Direction {
  return value === "up" || value === "down";
}

function isRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SessionRecord>;
  return (
    item.schemaVersion === 1 &&
    typeof item.questionId === "string" &&
    isDirection(item.given) &&
    isDirection(item.answer) &&
    typeof item.correct === "boolean" &&
    typeof item.responseMs === "number" &&
    typeof item.answeredAt === "string"
  );
}

function history(): SessionRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function percent(records: readonly SessionRecord[]): number {
  return records.length
    ? Math.round((records.filter((r) => r.correct).length / records.length) * 100)
    : 0;
}

function currentStreak(records: readonly SessionRecord[]): number {
  let streak = 0;
  for (const record of records) streak = record.correct ? streak + 1 : 0;
  return streak;
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

// Cached after the first successful fetch — rebuilt only on import.
let metaCache: Map<string, QuestionMeta> | null = null;

async function questionMeta(): Promise<Map<string, QuestionMeta>> {
  if (metaCache) return metaCache;
  const base = "../tickread/code/data";
  const manifest = (await (await fetch(`${base}/manifest.json`)).json()) as Manifest;
  const pages = await Promise.all(
    manifest.shards.map(async (shard) =>
      (await (await fetch(`${base}/${shard.file}`)).json()) as unknown[]
    )
  );
  const map = new Map<string, QuestionMeta>();
  for (const value of pages.flat()) {
    if (!value || typeof value !== "object") continue;
    const item = value as Partial<QuestionMeta>;
    if (
      typeof item.id === "string" &&
      typeof item.assetClass === "string" &&
      typeof item.timeframe === "string" &&
      typeof item.horizon === "number"
    ) {
      map.set(item.id, {
        id: item.id,
        assetClass: item.assetClass,
        timeframe: item.timeframe,
        horizon: item.horizon,
      });
    }
  }
  metaCache = map;
  return map;
}

function group(
  records: readonly SessionRecord[],
  meta: ReadonlyMap<string, QuestionMeta>,
  field: keyof Omit<QuestionMeta, "id">
): string[] {
  const buckets = new Map<string, SessionRecord[]>();
  for (const record of records) {
    const value = meta.get(record.questionId)?.[field];
    if (value === undefined) continue;
    const key = String(value);
    const list = buckets.get(key) ?? [];
    list.push(record);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .filter(([, list]) => list.length >= GROUP_MINIMUM)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => `${field}: ${key} · ${percent(list)}% (${list.length})`);
}

function drawTrend(canvas: HTMLCanvasElement, records: readonly SessionRecord[]): void {
  const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width));
  const height = 84;
  const dpr = devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  if (!records.length) return;

  ctx.strokeStyle = "#b7dc6f";
  ctx.lineWidth = 2;

  if (records.length === 1) {
    // A single point can't form a line — draw a dot instead.
    ctx.fillStyle = "#b7dc6f";
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  let correct = 0;
  records.forEach((record, i) => {
    correct += record.correct ? 1 : 0;
    const x = (i / (records.length - 1)) * width;
    const y = height - 8 - (correct / (i + 1)) * (height - 16);
    if (!i) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function exportHistory(): void {
  const blob = new Blob([JSON.stringify(history(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tickread-history.json";
  link.click();
  URL.revokeObjectURL(url);
}

function mount(): void {
  const home = byId<HTMLElement>("home-screen");
  const game = byId<HTMLElement>("game-screen");
  const report = byId<HTMLElement>("report-screen");
  const lifetime = byId<HTMLElement>("lifetime");

  const historyButton = document.createElement("button");
  historyButton.className = "secondary";
  historyButton.textContent = "History";
  home.querySelector("#start-button")?.after(historyButton);

  const screen = document.createElement("section");
  screen.className = "screen";
  screen.hidden = true;
  screen.innerHTML =
    '<p class="eyebrow">YOUR HISTORY</p>' +
    "<h2>Training report</h2>" +
    '<p id="m2-summary" class="muted"></p>' +
    '<canvas id="m2-trend" aria-label="Hit rate over time" role="img"></canvas>' +
    '<pre id="m2-groups" class="history-card"></pre>' +
    '<p id="m2-style" class="muted"></p>' +
    '<button id="m2-export" class="secondary">Export history</button>' +
    '<button id="m2-import" class="secondary">Import history</button>' +
    '<input id="m2-file" type="file" accept="application/json" hidden>' +
    '<button id="m2-clear" class="danger">Clear history</button>' +
    '<button id="m2-back" class="primary">Back home</button>';
  home.parentElement?.append(screen);

  // Updates #lifetime on the home screen with hit rate, count, and current streak.
  // M2 owns this stat line. A MutationObserver re-applies it whenever app.ts
  // overwrites it (e.g. after showReport() calls updateLifetime()).
  function updateHomeStat(): void {
    const records = history();
    const nextText = records.length
      ? `${percent(records)}% lifetime hit rate · ${records.length} calls · streak ${currentStreak(records)}`
      : "No history yet";
    // This function is also the MutationObserver callback. Avoid writing the
    // same value back into the observed node, which would schedule another
    // mutation forever and starve clicks on the home screen.
    if (lifetime.textContent !== nextText) lifetime.textContent = nextText;
  }

  const render = async (): Promise<void> => {
    updateHomeStat();
    const records = history();
    byId<HTMLElement>("m2-summary").textContent = records.length
      ? `${percent(records)}% hit rate across ${records.length} calls`
      : "No history yet";
    drawTrend(byId<HTMLCanvasElement>("m2-trend"), records);
    try {
      const meta = await questionMeta();
      const lines = (["assetClass", "timeframe", "horizon"] as const).flatMap((field) =>
        group(records, meta, field)
      );
      byId<HTMLElement>("m2-groups").textContent = lines.length
        ? lines.join("\n")
        : `Not enough data yet — groups appear at ${GROUP_MINIMUM} answers.`;
    } catch {
      byId<HTMLElement>("m2-groups").textContent =
        "History groups are unavailable until the question bank loads.";
    }
    byId<HTMLElement>("m2-style").textContent =
      records.length >= STYLE_MINIMUM
        ? `${Math.round((records.filter((r) => r.given === "up").length / records.length) * 100)}% bullish calls · ${Math.round(records.reduce((total, r) => total + r.responseMs, 0) / records.length / 100) / 10} s average response`
        : `Decision style appears at ${STYLE_MINIMUM} answers.`;
  };

  // Re-apply the streak stat line whenever app.ts overwrites #lifetime
  // (triggered after every round via showReport → updateLifetime).
  const lifetimeObserver = new MutationObserver(updateHomeStat);
  lifetimeObserver.observe(lifetime, { childList: true, characterData: true, subtree: true });

  historyButton.addEventListener("click", () => {
    home.hidden = true;
    game.hidden = true;
    report.hidden = true;
    screen.hidden = false;
    void render();
  });

  byId<HTMLButtonElement>("m2-back").addEventListener("click", () => {
    screen.hidden = true;
    home.hidden = false;
    void render();
  });

  byId<HTMLButtonElement>("m2-export").addEventListener("click", exportHistory);

  byId<HTMLButtonElement>("m2-import").addEventListener("click", () =>
    byId<HTMLInputElement>("m2-file").click()
  );

  byId<HTMLInputElement>("m2-file").addEventListener("change", async () => {
    const input = byId<HTMLInputElement>("m2-file");
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!Array.isArray(parsed) || !parsed.every(isRecord)) throw new Error("invalid");
      if (!window.confirm(`Replace your current history with ${parsed.length} imported records?`)) {
        input.value = "";
        return;
      }
      // Bust the meta cache so re-imported question IDs are re-resolved.
      metaCache = null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {
      window.alert("That file is not a valid tickread history export.");
    }
    input.value = "";
    await render();
  });

  byId<HTMLButtonElement>("m2-clear").addEventListener("click", () => {
    if (window.confirm("Clear all local tickread history?")) {
      localStorage.removeItem(STORAGE_KEY);
      void render();
    }
  });

  void render();
}

mount();

export {};
