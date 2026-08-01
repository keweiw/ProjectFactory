/**
 * Candlestick and volume renderer. Pure: a function of (context, data, options).
 *
 * This is the render-time half of the anonymisation rule. The Y axis is expressed
 * as a percentage of the last setup close and no absolute price or date is ever
 * drawn — otherwise "$61,234" identifies Bitcoin and a date identifies the event.
 *
 * Every bar, wick and body alike, is drawn with fillRect. That keeps all data
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
}

export interface ChartOptions {
  width: number;
  height: number;
  dpr: number;
  revealCount: number;
  theme: ChartTheme;
}

export const DEFAULT_THEME: ChartTheme = {
  up: "#22a06b",
  down: "#d1495b",
  grid: "rgba(128,128,128,0.18)",
  text: "rgba(128,128,128,0.85)",
  volumeUp: "rgba(34,160,107,0.55)",
  volumeDown: "rgba(209,73,91,0.55)",
  divider: "rgba(128,128,128,0.5)",
};

/** Reserved on the right for axis labels. */
const GUTTER = 44;
const PRICE_BOTTOM = 0.72;
const VOLUME_TOP = 0.75;
const FUTURE_ALPHA = 0.5;

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

  // Slots are reserved for the whole future even while it is hidden, so revealing
  // slides new candles in rather than re-laying out the ones already on screen.
  const slots = setup.length + future.length;
  const plotWidth = width - GUTTER;
  const slot = plotWidth / slots;
  const candleWidth = Math.max(1, slot * 0.7);
  const wickWidth = Math.max(1, candleWidth * 0.18);

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
  const xOf = (index: number): number => index * slot + (slot - candleWidth) / 2;

  ctx.save();
  ctx.scale(dpr, dpr);

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

  // --- bars ---
  for (let i = 0; i < visible.length; i++) {
    const bar = visible[i]!;
    const isFuture = i >= setup.length;
    ctx.globalAlpha = isFuture ? FUTURE_ALPHA : 1;

    const rising = bar.c >= bar.o;
    const x = xOf(i);

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

  // --- setup/future divider, only once there is something to divide ---
  if (revealCount > 0) {
    const x = setup.length * slot;
    ctx.strokeStyle = theme.divider;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  ctx.restore();
}
