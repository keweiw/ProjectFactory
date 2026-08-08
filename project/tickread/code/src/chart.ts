/**
 * Candlestick and volume renderer. Pure: a function of (context, data, options).
 *
 * This is the render-time half of the anonymisation rule. The Y axis is expressed
 * as a percentage of the last setup close and no absolute price or date is ever
 * drawn — otherwise "$61,234" identifies Bitcoin and a date identifies the event.
 *
 * Every bar, wick and body alike, is drawn with fillRect, and *only* bars are:
 * the forecast zone shades itself with a path fill instead. That keeps all data
 * drawing to a single call so a test can assert that nothing appears past the
 * setup boundary while the future is hidden. See specs/chart.md.
 */

import type { Bar } from "./types.js";

export type { Bar } from "./types.js";

export interface ChartTheme {
  up: string;
  down: string;
  grid: string;
  text: string;
  volumeUp: string;
  volumeDown: string;
  divider: string;
  /** Wash over the region the question is asking about. */
  forecastFill: string;
  /** The level the answer is measured from, carried across that region. */
  forecastBorder: string;
  /** The "NEXT n BARS" caption. */
  forecastText: string;
}

export interface ChartOptions {
  width: number;
  height: number;
  dpr: number;
  revealCount: number;
  theme: ChartTheme;
}

// Mid greys throughout the forecast styling: they read on both the light and the
// dark page, and — more importantly — they carry no up/down connotation. A tinted
// zone would be a hint about the answer sitting right next to the question.
export const DEFAULT_THEME: ChartTheme = {
  up: "#22a06b",
  down: "#d1495b",
  grid: "rgba(128,128,128,0.18)",
  text: "rgba(128,128,128,0.85)",
  volumeUp: "rgba(34,160,107,0.55)",
  volumeDown: "rgba(209,73,91,0.55)",
  divider: "rgba(128,128,128,0.5)",
  forecastFill: "rgba(128,128,128,0.10)",
  forecastBorder: "rgba(128,128,128,0.45)",
  forecastText: "rgba(128,128,128,0.9)",
};

/** Reserved on the right for axis labels. */
const GUTTER = 44;
const PRICE_BOTTOM = 0.72;
const VOLUME_TOP = 0.75;
const FUTURE_ALPHA = 0.5;

/**
 * A one-bar horizon is 1/61 of the plot — a sliver nobody would notice. But a flat
 * minimum width is worse than the problem: at any sane floor both a 1-bar and a
 * 5-bar zone clamp to it and render *identically*, so the width stops meaning
 * anything exactly where the reader most needs it to.
 *
 * So the floor grows with the horizon instead of being constant. sqrt is the
 * compression that makes this work: it lifts the small horizons clear of invisible
 * while landing almost exactly on the natural width by the time the horizon is 20,
 * so a long zone is still honestly proportional. At a 356px plot the three shipped
 * horizons come out 20 / 45 / 89 px against naturals of 6 / 27 / 89.
 */
const MIN_FORECAST_UNIT = 20;

/** The zone may never take more than this share of the plot. */
const MAX_FORECAST_SHARE = 0.5;

export interface ForecastGeometry {
  setupWidth: number;
  forecastWidth: number;
  setupSlot: number;
  forecastSlot: number;
}

/**
 * Splits the plot between the bars you are reading and the bars you are predicting.
 *
 * Exported because it is the one piece of layout that has to be identical whether
 * the future is hidden or shown — the reveal must slide candles into a zone that is
 * already there, not re-lay the chart out underneath the user.
 */
export function forecastGeometry(
  setupCount: number,
  futureCount: number,
  plotWidth: number,
): ForecastGeometry {
  const width = Math.max(0, plotWidth);
  if (width <= 0 || setupCount <= 0 || futureCount <= 0) {
    return {
      setupWidth: width,
      forecastWidth: 0,
      setupSlot: setupCount > 0 ? width / setupCount : 0,
      forecastSlot: 0,
    };
  }
  const natural = (width * futureCount) / (setupCount + futureCount);
  const floor = MIN_FORECAST_UNIT * Math.sqrt(futureCount);
  const forecastWidth = Math.min(width * MAX_FORECAST_SHARE, Math.max(floor, natural));
  const setupWidth = width - forecastWidth;
  return {
    setupWidth,
    forecastWidth,
    setupSlot: setupWidth / setupCount,
    forecastSlot: forecastWidth / futureCount,
  };
}

function formatPercent(p: number): string {
  const snapped = Math.abs(p) < 1e-9 ? 0 : p;
  const sign = snapped > 0 ? "+" : snapped < 0 ? "-" : "";
  return `${sign}${Math.abs(snapped).toFixed(1)}%`;
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

/** A round-ish gridline step at or above `raw`. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export function renderChart(
  ctx: CanvasRenderingContext2D,
  setup: readonly Bar[],
  future: readonly Bar[],
  options: ChartOptions,
): void {
  const { width, height, dpr, theme } = options;
  if (width <= 0 || height <= 0 || setup.length === 0) return;

  const revealCount = Math.max(0, Math.min(future.length, Math.floor(options.revealCount)));
  const revealed = future.slice(0, revealCount);
  const visible = [...setup, ...revealed];

  // Space is reserved for the whole future even while it is hidden, so revealing
  // slides new candles in rather than re-laying out the ones already on screen.
  const plotWidth = width - GUTTER;
  const { setupWidth, forecastWidth, setupSlot, forecastSlot } = forecastGeometry(
    setup.length,
    future.length,
    plotWidth,
  );
  const setupCandleWidth = Math.max(1, setupSlot * 0.7);
  // Future candles keep the setup's pitch rather than spreading over a widened zone.
  // A one-bar forecast then continues straight on from the last known bar, and the
  // surplus zone width shows as empty space to the right — not as a gap in the data,
  // and not as one implausibly fat candle.
  const futurePitch = forecastSlot > 0 ? Math.min(setupSlot, forecastSlot) : 0;
  const futureCandleWidth = futurePitch > 0 ? Math.max(1, futurePitch * 0.7) : setupCandleWidth;

  let low = Infinity;
  let high = -Infinity;
  let maxVolume = 0;
  for (const b of visible) {
    if (b.l < low) low = b.l;
    if (b.h > high) high = b.h;
    if (b.v > maxVolume) maxVolume = b.v;
  }
  const reference = setup[setup.length - 1]!.c;
  if (!(high > low)) {
    // Perfectly flat window: fall back to a symmetric band so the scale is usable.
    const band = Math.abs(reference) * 0.01 || 1;
    low = reference - band;
    high = reference + band;
  }
  if (maxVolume <= 0) maxVolume = 1;

  const priceBottom = height * PRICE_BOTTOM;
  const volumeTop = height * VOLUME_TOP;
  const volumeHeight = height - volumeTop;

  const yOf = (price: number): number =>
    priceBottom - ((price - low) / (high - low)) * priceBottom;
  const widthOf = (index: number): number =>
    index < setup.length ? setupCandleWidth : futureCandleWidth;
  const xOf = (index: number): number =>
    index < setup.length
      ? index * setupSlot + (setupSlot - setupCandleWidth) / 2
      : setupWidth +
        (index - setup.length) * futurePitch +
        (futurePitch - futureCandleWidth) / 2;

  ctx.save();
  ctx.scale(dpr, dpr);

  // --- the forecast zone, laid down first so the grid reads over it ---
  // Deliberately a path fill rather than fillRect: fillRect means "a bar", and the
  // hidden-future test relies on that.
  if (forecastWidth > 0) {
    ctx.fillStyle = theme.forecastFill;
    ctx.beginPath();
    ctx.rect(setupWidth, 0, forecastWidth, height);
    ctx.fill();
  }

  // --- grid and percentage axis ---
  const pctLow = (low / reference - 1) * 100;
  const pctHigh = (high / reference - 1) * 100;
  const step = niceStep((pctHigh - pctLow) / 4);

  ctx.strokeStyle = theme.grid;
  ctx.fillStyle = theme.text;
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (let pct = Math.ceil(pctLow / step) * step; pct <= pctHigh; pct += step) {
    const y = yOf(reference * (1 + pct / 100));
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotWidth, y);
    ctx.stroke();
    ctx.fillText(formatPercent(pct), plotWidth + 6, y);
  }

  ctx.fillText(formatVolume(maxVolume), plotWidth + 6, volumeTop + 6);

  // --- where the known stops and the question starts ---
  if (forecastWidth > 0) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = theme.divider;
    ctx.beginPath();
    ctx.moveTo(setupWidth, 0);
    ctx.lineTo(setupWidth, height);
    ctx.stroke();

    // The last setup close, carried flat across the zone. This is the line the
    // answer is measured against, so showing it turns "up or down?" into a
    // question about a level the user can actually see.
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = theme.forecastBorder;
    const flat = yOf(reference);
    ctx.beginPath();
    ctx.moveTo(setupWidth, flat);
    ctx.lineTo(plotWidth, flat);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // --- bars ---
  for (let i = 0; i < visible.length; i++) {
    const bar = visible[i]!;
    const isFuture = i >= setup.length;
    ctx.globalAlpha = isFuture ? FUTURE_ALPHA : 1;

    const rising = bar.c >= bar.o;
    const x = xOf(i);
    const candleWidth = widthOf(i);
    const wickWidth = Math.max(1, candleWidth * 0.18);

    ctx.fillStyle = rising ? theme.up : theme.down;
    const wickTop = yOf(bar.h);
    ctx.fillRect(
      x + (candleWidth - wickWidth) / 2,
      wickTop,
      wickWidth,
      Math.max(1, yOf(bar.l) - wickTop),
    );

    const bodyTop = yOf(Math.max(bar.o, bar.c));
    ctx.fillRect(x, bodyTop, candleWidth, Math.max(1, yOf(Math.min(bar.o, bar.c)) - bodyTop));

    ctx.fillStyle = rising ? theme.volumeUp : theme.volumeDown;
    const barHeight = Math.max(1, (bar.v / maxVolume) * volumeHeight);
    ctx.fillRect(x, volumeTop + volumeHeight - barHeight, candleWidth, barHeight);
  }
  ctx.globalAlpha = 1;

  // --- the caption, last so revealed candles cannot bury it ---
  if (forecastWidth > 0) {
    const count = `${future.length} ${future.length === 1 ? "BAR" : "BARS"}`;
    ctx.fillStyle = theme.forecastText;
    ctx.textBaseline = "middle";
    ctx.font = "600 11px system-ui, sans-serif";

    // Centred in the zone when it fits, otherwise anchored to the plot's right
    // edge. The caption must not be what decides how wide the zone is — that is
    // the mistake the sqrt floor above exists to avoid.
    const needed = ctx.measureText(count).width;
    if (needed + 6 <= forecastWidth) {
      ctx.textAlign = "center";
      const centre = setupWidth + forecastWidth / 2;
      ctx.fillText(count, centre, 24);
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.fillText("NEXT", centre, 11);
    } else {
      ctx.textAlign = "right";
      ctx.fillText(count, plotWidth, 24);
      ctx.font = "600 9px system-ui, sans-serif";
      ctx.fillText("NEXT", plotWidth, 11);
    }
  }

  ctx.restore();
}
