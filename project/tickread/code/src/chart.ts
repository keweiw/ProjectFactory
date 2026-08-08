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
  /**
   * How much of the future to draw. Fractional: the whole part is bars that have
   * fully arrived, the fraction is how far the next one has formed. An integer
   * behaves exactly as it always did, so a caller that does not animate is unaffected.
   */
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
/**
 * Headroom above the highest bar, reserved for the "NEXT n BARS" caption.
 *
 * Without it the price scale ran to y=0, so the tallest candle touched the top of the
 * plot and the caption — drawn at y=11 and y=24 — sat on top of it whenever the high
 * came late in the window. Clamping the caption elsewhere only moved the collision;
 * reserving the band means nothing is ever drawn there in the first place, at every
 * horizon rather than just the narrow ones.
 */
const TOP_INSET = 32;
const PRICE_BOTTOM = 0.72;
const VOLUME_TOP = 0.75;
const FUTURE_ALPHA = 0.5;
/** A forming bar starts at this share of a revealed bar's opacity, never at nothing. */
const FORMING_ALPHA_FLOOR = 0.3;

/**
 * A bar caught part way through arriving, drawn as one growing out of `from` — the
 * close it follows.
 *
 * All four prices are interpolated from that single level, so at t=0 the bar is a
 * flat mark on the previous close and at t=1 it is itself. Because every price moves
 * from the same start, high stays above low throughout and the shape is never
 * momentarily nonsense; the bar looks like one being printed live, which is what the
 * chart is depicting anyway.
 */
function formingBar(bar: Bar, from: number, t: number): Bar {
  const at = (price: number): number => from + (price - from) * t;
  return { o: at(bar.o), h: at(bar.h), l: at(bar.l), c: at(bar.c), v: bar.v * t };
}

/**
 * A one-bar horizon is 1/61 of the plot — a sliver nobody would notice, so a short
 * horizon has to be given room. The previous version widened the *zone* to a floor
 * while leaving the candles at the setup's pitch, which put a 20px shaded band around
 * a 6px candle: the shadow was visibly wider than the bar it was supposed to be
 * about, and the surplus read as missing data rather than as emphasis.
 *
 * So the room goes to the bar instead. A short horizon gets a wider pitch, and the
 * zone is then exactly `futureCount * pitch` — the shaded region and the bars in it
 * are the same object, at every horizon, and nothing is left over. A one-bar forecast
 * becomes one deliberately chunky candle rather than a thin one adrift in grey.
 *
 * The extra room decays exponentially, so it has all but vanished by a horizon of 5
 * and the long horizons keep their honest proportion. At a 356px plot the three
 * shipped horizons come out 19 / 31 / 89 px against naturals of 6 / 27 / 89.
 */
const EXTRA_AT_ONE = 2.4;
/**
 * How fast the extra room decays. It must exceed EXTRA_AT_ONE, or the decay outruns
 * the horizon's own growth and a 2-bar zone comes out no wider than a 1-bar one —
 * which is the failure a flat minimum width had, and the reason a zone's width is
 * only worth drawing if it always means something.
 */
const EXTRA_DECAY = 3;

/** The zone may never take more than this share of the plot. */
const MAX_FORECAST_SHARE = 0.5;

/**
 * The horizon's width in setup-slot units: `n` bars plus the shrinking allowance that
 * keeps a short horizon legible. Strictly increasing in `n`.
 */
function forecastUnits(futureCount: number): number {
  return futureCount + EXTRA_AT_ONE * Math.exp(-(futureCount - 1) / EXTRA_DECAY);
}

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
  // The plot is cut into `setupCount` unit slots plus the horizon's own units, so the
  // zone comes out as exactly the space its bars occupy — no leftover shading.
  const units = forecastUnits(futureCount);
  const unitSlot = width / (setupCount + units);
  const forecastWidth = Math.min(width * MAX_FORECAST_SHARE, units * unitSlot);
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

  const revealCount = Math.max(0, Math.min(future.length, options.revealCount));
  const landed = Math.floor(revealCount);
  const forming = revealCount - landed;
  const revealed = future.slice(0, landed);
  const isForming = forming > 0 && landed < future.length;

  // A forming bar grows out of the close before it: the last one revealed, or the
  // last setup close when it is the first bar of the future.
  const previousClose = (revealed[revealed.length - 1] ?? setup[setup.length - 1]!).c;
  const visible = isForming
    ? [...setup, ...revealed, formingBar(future[landed]!, previousClose, forming)]
    : [...setup, ...revealed];

  // The scale is taken over the bar's *finished* extent, not the part drawn so far,
  // so the axis steps once as a bar begins rather than creeping under the reader for
  // the whole time it is growing. For an integer count this is exactly `visible`.
  const scaled = [...setup, ...future.slice(0, Math.ceil(revealCount))];

  // Space is reserved for the whole future even while it is hidden, so revealing
  // slides new candles in rather than re-laying out the ones already on screen.
  const plotWidth = width - GUTTER;
  const { setupWidth, forecastWidth, setupSlot, forecastSlot } = forecastGeometry(
    setup.length,
    future.length,
    plotWidth,
  );
  const setupCandleWidth = Math.max(1, setupSlot * 0.7);
  // Future candles take the zone's own pitch, which `forecastGeometry` already sized
  // so that the bars fill it exactly. Every bar on the chart, past or future, fills
  // 70% of its slot; a short horizon simply has a wider slot to fill.
  const futurePitch = forecastSlot;
  const futureCandleWidth = futurePitch > 0 ? Math.max(1, futurePitch * 0.7) : setupCandleWidth;

  let low = Infinity;
  let high = -Infinity;
  let maxVolume = 0;
  for (const b of scaled) {
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

  // Prices map into [TOP_INSET, priceBottom], never to the very top of the plot.
  const priceTop = Math.min(TOP_INSET, priceBottom * 0.4);
  const yOf = (price: number): number =>
    priceBottom - ((price - low) / (high - low)) * (priceBottom - priceTop);
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
    // The bar still forming fades up as it grows, so it reads as arriving rather
    // than as a bar that is simply drawn wrong.
    const thisOneForming = isForming && i === visible.length - 1;
    ctx.globalAlpha = thisOneForming
      ? FUTURE_ALPHA * (FORMING_ALPHA_FLOOR + (1 - FORMING_ALPHA_FLOOR) * forming)
      : isFuture
        ? FUTURE_ALPHA
        : 1;

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
