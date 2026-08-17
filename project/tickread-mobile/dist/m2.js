const STORAGE_KEY = "tickread-mobile.records.v1";
const GROUP_MINIMUM = 20;
const STYLE_MINIMUM = 30;
function isDirection(value) { return value === "up" || value === "down"; }
function isRecord(value) {
    if (!value || typeof value !== "object")
        return false;
    const item = value;
    return item.schemaVersion === 1 && typeof item.questionId === "string" && isDirection(item.given) &&
        isDirection(item.answer) && typeof item.correct === "boolean" && typeof item.responseMs === "number" && typeof item.answeredAt === "string";
}
function history() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    }
    catch {
        return [];
    }
}
function percent(records) { return records.length ? Math.round(records.filter((r) => r.correct).length / records.length * 100) : 0; }
function currentStreak(records) { let streak = 0; for (const record of records)
    streak = record.correct ? streak + 1 : 0; return streak; }
function byId(id) { const node = document.getElementById(id); if (!node)
    throw new Error(`Missing #${id}`); return node; }
async function questionMeta() {
    const base = "../tickread/code/data";
    const manifest = await (await fetch(`${base}/manifest.json`)).json();
    const pages = await Promise.all(manifest.shards.map(async (shard) => (await (await fetch(`${base}/${shard.file}`)).json())));
    const map = new Map();
    for (const value of pages.flat()) {
        if (!value || typeof value !== "object")
            continue;
        const item = value;
        if (typeof item.id === "string" && typeof item.assetClass === "string" && typeof item.timeframe === "string" && typeof item.horizon === "number") {
            map.set(item.id, { id: item.id, assetClass: item.assetClass, timeframe: item.timeframe, horizon: item.horizon });
        }
    }
    return map;
}
function group(records, meta, field) {
    const buckets = new Map();
    for (const record of records) {
        const value = meta.get(record.questionId)?.[field];
        if (value === undefined)
            continue;
        const key = String(value);
        const list = buckets.get(key) ?? [];
        list.push(record);
        buckets.set(key, list);
    }
    return [...buckets.entries()].filter(([, list]) => list.length >= GROUP_MINIMUM).sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => `${field}: ${key} · ${percent(list)}% (${list.length})`);
}
function drawTrend(canvas, records) {
    const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width));
    const height = 84;
    const dpr = devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    if (!records.length)
        return;
    ctx.strokeStyle = "#b7dc6f";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let correct = 0;
    records.forEach((record, index) => { correct += record.correct ? 1 : 0; const x = records.length === 1 ? width / 2 : index / (records.length - 1) * width; const y = height - 8 - correct / (index + 1) * (height - 16); if (!index)
        ctx.moveTo(x, y);
    else
        ctx.lineTo(x, y); });
    ctx.stroke();
}
function exportHistory() { const blob = new Blob([JSON.stringify(history(), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "tickread-history.json"; link.click(); URL.revokeObjectURL(url); }
function mount() {
    const home = byId("home-screen");
    const game = byId("game-screen");
    const report = byId("report-screen");
    const lifetime = byId("lifetime");
    const historyButton = document.createElement("button");
    historyButton.className = "secondary";
    historyButton.textContent = "History";
    home.querySelector("#start-button")?.after(historyButton);
    const screen = document.createElement("section");
    screen.className = "screen";
    screen.hidden = true;
    screen.innerHTML = '<p class="eyebrow">YOUR HISTORY</p><h2>Training report</h2><p id="m2-summary" class="muted"></p><canvas id="m2-trend" aria-label="Hit rate over time" role="img"></canvas><pre id="m2-groups" class="history-card"></pre><p id="m2-style" class="muted"></p><button id="m2-export" class="secondary">Export history</button><button id="m2-import" class="secondary">Import history</button><input id="m2-file" type="file" accept="application/json" hidden><button id="m2-clear" class="danger">Clear history</button><button id="m2-back" class="primary">Back home</button>';
    home.parentElement?.append(screen);
    const render = async () => {
        const records = history();
        lifetime.textContent = records.length ? `${percent(records)}% lifetime hit rate · ${records.length} calls · streak ${currentStreak(records)}` : "No history yet";
        byId("m2-summary").textContent = records.length ? `${percent(records)}% hit rate across ${records.length} calls` : "No history yet";
        drawTrend(byId("m2-trend"), records);
        try {
            const meta = await questionMeta();
            const lines = ["assetClass", "timeframe", "horizon"].flatMap((field) => group(records, meta, field));
            byId("m2-groups").textContent = lines.length ? lines.join("\n") : `Not enough data yet — groups appear at ${GROUP_MINIMUM} answers.`;
        }
        catch {
            byId("m2-groups").textContent = "History groups are unavailable until the question bank loads.";
        }
        byId("m2-style").textContent = records.length >= STYLE_MINIMUM ? `${Math.round(records.filter((r) => r.given === "up").length / records.length * 100)}% bullish calls · ${Math.round(records.reduce((total, r) => total + r.responseMs, 0) / records.length / 100) / 10} s average response` : `Decision style appears at ${STYLE_MINIMUM} answers.`;
    };
    historyButton.addEventListener("click", () => { home.hidden = true; game.hidden = true; report.hidden = true; screen.hidden = false; void render(); });
    byId("m2-back").addEventListener("click", () => { screen.hidden = true; home.hidden = false; void render(); });
    byId("m2-export").addEventListener("click", exportHistory);
    byId("m2-import").addEventListener("click", () => byId("m2-file").click());
    byId("m2-file").addEventListener("change", async () => { const input = byId("m2-file"); const file = input.files?.[0]; if (!file)
        return; try {
        const parsed = JSON.parse(await file.text());
        if (!Array.isArray(parsed) || !parsed.every(isRecord))
            throw new Error("invalid");
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    }
    catch {
        window.alert("That file is not a valid tickread history export.");
    } input.value = ""; await render(); });
    byId("m2-clear").addEventListener("click", () => { if (window.confirm("Clear all local tickread history?")) {
        localStorage.removeItem(STORAGE_KEY);
        void render();
    } });
    void render();
}
mount();
export {};
