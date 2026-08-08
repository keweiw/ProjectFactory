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

import {
  answersToUnlock,
  buildAdvice,
  gradeFor,
  personaShape,
  roundAccuracies,
  skillGrid,
  type Advice,
  type ShapeAxis,
  type SkillCell,
  type SkillState,
} from "./advice.js";
import { buildRound, DEFAULT_DECK_SIZE } from "./deck.js";
import { renderChart, DEFAULT_THEME } from "./chart.js";
import { computePersona } from "./persona.js";
import { answer, createSession, currentQuestion, isFinished, progress } from "./session.js";
import { buildScorecard, MIN_SAMPLE } from "./stats.js";
import { createHistoryStore, type HistoryStore } from "./storage.js";
import {
  HORIZON_ORDER,
  TIMEFRAME_ORDER,
  type AnswerRecord,
  type AssetClass,
  type BucketStat,
  type Direction,
  type Horizon,
  type Question,
  type SessionState,
  type Timeframe,
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

const TIMEFRAME_WORDS: Record<Timeframe, string> = {
  "1m": "1-minute",
  "1h": "Hourly",
  "1d": "Daily",
  "1mo": "Monthly",
};

const ASSET_WORDS: Record<AssetClass, string> = {
  equity: "US equity",
  etf_index: "ETF / index",
  future: "Futures",
  crypto: "Crypto",
};

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

export type MetricKind = "percent" | "signed" | "ms" | "ratio";

/**
 * Renders a persona metric. A null metric means the sample could not support it,
 * and must never appear as 0 — that would present an absent measurement as a
 * finding about the user.
 */
export function formatMetric(value: number | null, kind: MetricKind): string {
  if (value === null) return "not enough data";
  switch (kind) {
    case "percent":
      return `${(value * 100).toFixed(0)}%`;
    case "signed":
      return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
    case "ms":
      return `${(value / 1000).toFixed(1)}s`;
    case "ratio":
      return value.toFixed(2);
  }
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function significanceLabel(stat: BucketStat): string {
  if (stat.significance === "strength") return `<span class="tag good">strength</span>`;
  if (stat.significance === "weakness") return `<span class="tag bad">weakness</span>`;
  return `<span class="tag muted">not enough data</span>`;
}

const BUCKET_WORDS: Record<string, string> = {
  ...TIMEFRAME_WORDS,
  ...ASSET_WORDS,
  "1": "next bar",
  "5": "next 5 bars",
  "20": "next 20 bars",
  overall: "Overall",
};

/**
 * One bucket as a diverging interval bar against a 50% baseline.
 *
 * The 95% range is the mark, not the point estimate: "62%" alone invites the reader
 * to believe a number the sample cannot support, and the whole product rests on not
 * doing that. Whether the band crosses the 50% line *is* the finding.
 *
 * Colour is deliberately not the primary channel. The app's green/red pair measures
 * ΔE 3.0 under deuteranopia — indistinguishable — so meaning is carried by position
 * against the baseline and by the written tag, with the (colour-blind safe) blue/red
 * pair only reinforcing them.
 */
function meterRow(bucket: BucketStat, label: string): string {
  const low = bucket.interval.low * 100;
  const high = bucket.interval.high * 100;
  const point = bucket.accuracy * 100;
  const state =
    bucket.significance === "strength" ? "pos" : bucket.significance === "weakness" ? "neg" : "flat";
  const tag =
    bucket.significance === "strength"
      ? "beats a coin flip"
      : bucket.significance === "weakness"
        ? "loses to a coin flip"
        : "no call yet";
  const readout =
    `${label}: ${point.toFixed(0)}% over ${bucket.total} answers · ` +
    `95% range ${low.toFixed(0)}–${high.toFixed(0)}% · ${tag}`;

  return `<div class="mrow is-${state}" title="${escapeHtml(readout)}">
    <div class="mrow-label">${escapeHtml(label)}</div>
    <div class="mtrack">
      <div class="mtrack-base"></div>
      <div class="mband" style="left:${low.toFixed(2)}%;width:${Math.max(0.6, high - low).toFixed(2)}%"></div>
      <div class="mdot" style="left:${point.toFixed(2)}%"></div>
    </div>
    <div class="mrow-value">${point.toFixed(0)}%</div>
    <div class="mrow-n">n=${bucket.total}</div>
    <div class="mrow-tag">${escapeHtml(tag)}</div>
  </div>`;
}

function meterSection(title: string, rows: BucketStat[]): string {
  if (rows.length === 0) return "";
  const body = rows.map((r) => meterRow(r, BUCKET_WORDS[r.key] ?? r.key)).join("");
  return `<section class="block">
    <h3>${escapeHtml(title)}</h3>
    <div class="meters">${body}</div>
  </section>`;
}

/**
 * A persona metric as a position on its own axis, rather than a bare signed number.
 * "+0.42" means nothing without knowing what the ends are; a dot between two named
 * poles means something immediately.
 */
function axisRow(
  name: string,
  value: number | null,
  kind: MetricKind,
  min: number,
  max: number,
  lowWord: string,
  highWord: string,
): string {
  const shown = formatMetric(value, kind);
  const ends =
    `<div class="axis-ends"><span>${escapeHtml(lowWord)}</span>` +
    `<span>${escapeHtml(highWord)}</span></div>`;

  if (value === null) {
    return `<div class="axis is-empty">
      <div class="axis-head"><span>${escapeHtml(name)}</span>
        <span class="muted">${escapeHtml(shown)}</span></div>
      <div class="axis-track"><div class="axis-mid"></div></div>
      ${ends}
    </div>`;
  }

  const at = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return `<div class="axis" title="${escapeHtml(`${name}: ${shown}`)}">
    <div class="axis-head"><span>${escapeHtml(name)}</span>
      <span class="axis-value">${escapeHtml(shown)}</span></div>
    <div class="axis-track"><div class="axis-mid"></div>
      <div class="axis-dot" style="left:${at.toFixed(2)}%"></div></div>
    ${ends}
  </div>`;
}

function statTile(label: string, value: string, hint: string): string {
  return `<div class="tile">
    <div class="tile-label">${escapeHtml(label)}</div>
    <div class="tile-value">${escapeHtml(value)}</div>
    <div class="tile-hint">${escapeHtml(hint)}</div>
  </div>`;
}

/**
 * The persona's four axes as a radar outline — the player's "shape".
 *
 * Square viewBox and uniform scaling, so this one really is drawn with circles and
 * polygons. Axis labels sit outside the rings; an unmeasured axis gets a hollow
 * vertex and a "?" so the outline never implies a measurement that was not taken.
 */
function radarChart(axes: readonly ShapeAxis[]): string {
  const size = 200;
  const centre = size / 2;
  const radius = 62;

  // Start at the top and go clockwise, so the shape is stable across renders.
  const angleOf = (i: number): number => (i / axes.length) * Math.PI * 2 - Math.PI / 2;
  const pointAt = (i: number, r: number): [number, number] => [
    centre + Math.cos(angleOf(i)) * r,
    centre + Math.sin(angleOf(i)) * r,
  ];

  const rings = [0.25, 0.5, 0.75, 1]
    .map((step) => `<circle class="rring" cx="${centre}" cy="${centre}" r="${(radius * step).toFixed(1)}"/>`)
    .join("");

  const spokes = axes
    .map((_, i) => {
      const [x, y] = pointAt(i, radius);
      return `<line class="rspoke" x1="${centre}" y1="${centre}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    })
    .join("");

  const vertices = axes.map((axis, i) => pointAt(i, radius * Math.max(0.06, axis.value)));
  const polygon = vertices.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const dots = axes
    .map((axis, i) => {
      const [x, y] = vertices[i]!;
      const cls = axis.unknown ? "rdot is-unknown" : "rdot";
      return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"><title>${escapeHtml(
        `${axis.label}: ${axis.unknown ? "not enough data" : Math.round(axis.value * 100) + "%"}`,
      )}</title></circle>`;
    })
    .join("");

  const labels = axes
    .map((axis, i) => {
      const [x, y] = pointAt(i, radius + 20);
      // Anchor by which side of the centre the label falls on, so nothing collides
      // with the outline or runs off the viewBox.
      const dx = x - centre;
      const anchor = Math.abs(dx) < 1 ? "middle" : dx > 0 ? "start" : "end";
      return `<text class="rlabel" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}"
        dominant-baseline="middle">${escapeHtml(axis.label)}${axis.unknown ? " ?" : ""}</text>`;
    })
    .join("");

  return `<svg class="radar" viewBox="0 0 ${size} ${size}" role="img"
    aria-label="Decision profile across ${axes.length} axes">
    ${rings}${spokes}
    <polygon class="rshape" points="${polygon}"/>
    ${dots}${labels}
  </svg>`;
}

const TIMEFRAME_SHORT: Record<Timeframe, string> = {
  "1m": "1m",
  "1h": "1h",
  "1d": "1D",
  "1mo": "1M",
};

const SKILL_MARK: Record<SkillState, string> = {
  cleared: "✓",
  failed: "✕",
  open: "·",
  locked: "",
};

const SKILL_WORD: Record<SkillState, string> = {
  cleared: "cleared",
  failed: "blind spot",
  open: "in progress",
  locked: "locked",
};

/**
 * The twelve timeframe x horizon cells as a map to uncover.
 *
 * The significance rule and a fog-of-war map turn out to be the same idea: a cell
 * with too little data is not shown as 50%, it is shown as *unknown*, with the
 * answers still needed. That reframes the report's refusal to guess as a reward to
 * chase rather than as a lecture — which is the only way a statistically honest
 * game stays fun.
 */
function skillMap(cells: readonly SkillCell[]): string {
  const byTimeframe = TIMEFRAME_ORDER.map((timeframe) => {
    const row = cells.filter((c) => c.timeframe === timeframe);
    const boxes = row
      .map((cell) => {
        const needed = answersToUnlock(cell);
        const readout =
          cell.state === "locked"
            ? `${TIMEFRAME_WORDS[cell.timeframe]}, ${cell.horizon}-bar: locked — ${needed} answers to unlock`
            : `${TIMEFRAME_WORDS[cell.timeframe]}, ${cell.horizon}-bar: ` +
              `${Math.round((cell.accuracy ?? 0) * 100)}% over ${cell.total} — ${SKILL_WORD[cell.state]}` +
              (needed > 0 ? ` (${needed} more to call it)` : "");
        const inner =
          cell.state === "locked"
            ? `<span class="cell-lock">?</span>`
            : `<span class="cell-mark">${SKILL_MARK[cell.state]}</span>
               <span class="cell-pct">${Math.round((cell.accuracy ?? 0) * 100)}</span>`;
        return `<div class="cell is-${cell.state}" title="${escapeHtml(readout)}">${inner}</div>`;
      })
      .join("");
    return `<div class="grid-label">${escapeHtml(TIMEFRAME_SHORT[timeframe])}</div>${boxes}`;
  }).join("");

  const unlocked = cells.filter((c) => c.state !== "locked").length;

  return `<section class="block">
    <h3>The map</h3>
    <div class="skillgrid">
      <div class="grid-corner"></div>
      ${HORIZON_ORDER.map((h) => `<div class="grid-head">${h}${h === 1 ? " bar" : " bars"}</div>`).join("")}
      ${byTimeframe}
    </div>
    <p class="grid-note">
      <span class="chip is-cleared">✓ cleared</span>
      <span class="chip is-failed">✕ blind spot</span>
      <span class="chip is-open">· in progress</span>
      <span class="chip is-locked">? locked</span>
      <span class="grid-note-text">${unlocked} of 12 squares opened. A square only turns
      ✓ or ✕ once it has ${MIN_SAMPLE}+ answers <em>and</em> the odds have clearly moved off a
      coin flip — so the ones still showing “·” are genuinely undecided, not hidden.</span>
    </p>
  </section>`;
}

/** Fewer than this and a "trend" is two dots and an opinion. */
const MIN_TREND_ROUNDS = 3;

/**
 * Accuracy per round as a line against the 50% baseline.
 *
 * Inline SVG rather than a canvas: it scales, it survives a theme change without a
 * repaint, and every point is reachable as a `<title>` for a screen reader. One
 * series, so no legend — the heading names it. Only the last point is labelled;
 * a number on every dot is noise.
 */
function trendChart(accuracies: readonly number[]): string {
  if (accuracies.length < MIN_TREND_ROUNDS) return "";

  const width = 100;
  const height = 34;
  const step = accuracies.length > 1 ? width / (accuracies.length - 1) : 0;
  const yOf = (accuracy: number): number => height - accuracy * height;

  const points = accuracies.map((a, i) => ({ x: i * step, y: yOf(a) }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");

  // Each dot is a zero-length stroke with a round cap, not a <circle>. The plot
  // stretches to its container, so x and y scale by different factors and a circle
  // would render as an ellipse; a round line cap is drawn in device space and stays
  // a circle at any aspect ratio.
  const dots = points
    .map(
      (p, i) =>
        `<path class="tdot" d="M${p.x.toFixed(2)} ${p.y.toFixed(2)}l0 0">` +
        `<title>Round ${i + 1}: ${(accuracies[i]! * 100).toFixed(0)}%</title></path>`,
    )
    .join("");

  const last = accuracies[accuracies.length - 1]!;
  const first = accuracies[0]!;
  const direction = last > first ? "up from" : last < first ? "down from" : "level with";

  return `<section class="block">
    <h3>Round by round</h3>
    <div class="trend">
      <svg class="trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
           role="img" aria-label="Accuracy by round, ${accuracies.length} rounds">
        <line class="tbase" x1="0" y1="${yOf(0.5)}" x2="${width}" y2="${yOf(0.5)}"></line>
        <path class="tline" d="${path}"></path>
        ${dots}
      </svg>
      <div class="trend-scale">
        <span>round 1</span>
        <span>round ${accuracies.length}</span>
      </div>
      <p class="trend-note">The flat rule is a coin flip. Latest round
        ${(last * 100).toFixed(0)}% — ${direction} your first at ${(first * 100).toFixed(0)}%.
        One round is ${DEFAULT_DECK_SIZE} answers, so a single point moves a long way on
        luck alone; the shape over several rounds is the part worth reading.</p>
    </div>
  </section>`;
}

function verdictCard(advice: Advice): string {
  const suggestion =
    advice.suggestion === null
      ? ""
      : `<p class="verdict-suggestion">${escapeHtml(advice.suggestion)}</p>`;

  let progress = "";
  if (advice.progress !== null && advice.progress.target !== null) {
    const { answers, target } = advice.progress;
    const filled = Math.min(100, Math.max(0, (answers / target) * 100));
    progress = `<div class="vprogress">
      <div class="vprogress-track"><div class="vprogress-fill" style="width:${filled.toFixed(2)}%"></div></div>
      <div class="vprogress-label">${answers} of about ${target} answers</div>
    </div>`;
  }

  return `<section class="verdict-card ${advice.settled ? "is-settled" : "is-open"}">
    <div class="verdict-kicker">${advice.settled ? "The read" : "Not yet"}</div>
    <h2 class="verdict-title">${escapeHtml(advice.title)}</h2>
    <p class="verdict-body">${escapeHtml(advice.body)}</p>
    ${suggestion}
    ${progress}
  </section>`;
}

function statRows(rows: BucketStat[]): string {
  return rows
    .map((row) => {
      const label = BUCKET_WORDS[row.key] ?? row.key;
      const pct = (row.accuracy * 100).toFixed(0);
      const lo = (row.interval.low * 100).toFixed(0);
      const hi = (row.interval.high * 100).toFixed(0);
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td class="num">${pct}%</td>
        <td class="num muted">n=${row.total}</td>
        <td class="num muted">${lo}–${hi}%</td>
        <td>${significanceLabel(row)}</td>
      </tr>`;
    })
    .join("");
}

function renderReport(elements: Elements, records: readonly AnswerRecord[]): void {
  const scorecard = buildScorecard(records);
  const persona = computePersona(records);
  const advice = buildAdvice(scorecard, persona, DEFAULT_DECK_SIZE);
  const overall = scorecard.overall;
  const metrics = persona.metrics;

  const tableSection = (title: string, rows: BucketStat[]): string =>
    rows.length === 0
      ? ""
      : `<h4>${escapeHtml(title)}</h4><table class="stats">
           <thead><tr><th></th><th class="num">accuracy</th><th class="num">sample</th>
           <th class="num">95% range</th><th></th></tr></thead>
           <tbody>${statRows(rows)}</tbody></table>`;

  const metricRow = (name: string, shown: string, hint: string): string =>
    `<tr><td>${escapeHtml(name)}</td><td class="num">${escapeHtml(shown)}</td>
       <td class="muted">${escapeHtml(hint)}</td></tr>`;

  const low = (overall.interval.low * 100).toFixed(0);
  const high = (overall.interval.high * 100).toFixed(0);

  const grade = gradeFor(overall);

  elements["report-body"]!.innerHTML = `
    <section class="charcard">
      <div class="charcard-top">
        <div class="grade ${grade.provisional ? "is-provisional" : "is-settled"}"
             title="${escapeHtml(
               grade.provisional
                 ? "Provisional — the sample cannot support a grade yet"
                 : "Earned: the 95% range clears a coin flip",
             )}">
          <span class="grade-letter">${escapeHtml(grade.letter)}</span>
          <span class="grade-tag">${grade.provisional ? "provisional" : "earned"}</span>
        </div>
        <div class="charcard-id">
          <div class="charcard-kicker">Your shape</div>
          <div class="charcard-name">${escapeHtml(persona.label ?? "Unclassified")}</div>
          <div class="charcard-figure">${(overall.accuracy * 100).toFixed(0)}<span class="hero-unit">%</span></div>
          <div class="hero-sub">${overall.correct} of ${overall.total} correct</div>
        </div>
      </div>

      ${radarChart(personaShape(metrics))}

      <div class="hero-meter" title="95% range ${low}–${high}%, against a 50% coin flip">
        <div class="hero-track">
          <div class="hero-base"></div>
          <div class="hero-band" style="left:${overall.interval.low * 100}%;width:${Math.max(0.6, (overall.interval.high - overall.interval.low) * 100)}%"></div>
          <div class="hero-dot" style="left:${overall.accuracy * 100}%"></div>
        </div>
        <div class="hero-scale"><span>0%</span><span>coin flip is the line</span><span>100%</span></div>
      </div>

      <div class="tiles">
        ${statTile("Decision speed", formatMetric(metrics.decisionSpeedMs, "ms"), "median time per card")}
        ${statTile("Consistency", formatMetric(metrics.consistency, "ratio"), "1.00 = same call on similar charts")}
      </div>
    </section>

    ${verdictCard(advice)}

    ${skillMap(skillGrid(records))}

    ${trendChart(roundAccuracies(records, DEFAULT_DECK_SIZE))}

    <details class="table-view">
      <summary>Show the full statistics</summary>

      ${meterSection("By timeframe", scorecard.byTimeframe)}
      ${meterSection("By asset class", scorecard.byAssetClass)}
      ${meterSection("By horizon", scorecard.byHorizon)}

      <p class="legend">
        <span class="key key-pos"></span> clears 50%
        <span class="key key-neg"></span> clears it from below
        <span class="key key-flat"></span> not enough to call
        <span class="legend-note">The bar is the 95% range, the dot is the estimate.
        A ${DEFAULT_DECK_SIZE}-question round split three ways is thin, so most rows stay
        undecided until you have played a few — switch to “All time” once you have.</span>
      </p>

      <h4>How you decide</h4>
      <div class="axes">
        ${axisRow("Bull bias", metrics.bullBias, "percent", 0, 1, "always down", "always up")}
        ${axisRow("Momentum vs reversion", metrics.momentumScore, "signed", -1, 1, "fades the trend", "follows the trend")}
        ${axisRow("Volume sensitivity", metrics.volumeSensitivity, "signed", -1, 1, "a surge turns you bearish", "a surge turns you bullish")}
        ${axisRow("Volatility sensitivity", metrics.volatilitySensitivity, "signed", -1, 1, "chop turns you bearish", "chop turns you bullish")}
      </div>

      ${tableSection("By asset class", scorecard.byAssetClass)}
      ${tableSection("By timeframe", scorecard.byTimeframe)}
      ${tableSection("By horizon", scorecard.byHorizon)}
      <h4>How you decide</h4>
      <table class="stats">
        <tbody>
          ${metricRow("Bull bias", formatMetric(metrics.bullBias, "percent"), "share of up swipes")}
          ${metricRow("Momentum vs reversion", formatMetric(metrics.momentumScore, "signed"), "positive follows the trend, negative fades it")}
          ${metricRow("Volume sensitivity", formatMetric(metrics.volumeSensitivity, "signed"), "how a volume surge shifts your call")}
          ${metricRow("Volatility sensitivity", formatMetric(metrics.volatilitySensitivity, "signed"), "how choppiness shifts your call")}
          ${metricRow("Decision speed", formatMetric(metrics.decisionSpeedMs, "ms"), "median time per card")}
          ${metricRow("Consistency", formatMetric(metrics.consistency, "ratio"), "1.00 means the same call on similar charts")}
        </tbody>
      </table>
    </details>
  `;
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
    renderReport(elements, records);
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
