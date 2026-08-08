# Chart

**Status:** SPEC_DRAFT
**GitHub Issue:** _not yet created_

## Purpose

Draws the candlestick and volume chart onto a canvas. This is the entire visual
surface of a question, and it is the component that enforces anonymisation at
render time: the Y axis is percentage-relative, never absolute price, and no date
is ever drawn.

A pure function of `(context, data, options)`. It holds no state, reads no DOM
beyond the context it is handed, and never schedules its own animation — `app.ts`
drives the reveal by calling it repeatedly with an increasing `revealCount`.

## Interfaces

```ts
export interface ChartTheme {
  bg: string;
  up: string;
  down: string;
  grid: string;
  text: string;
  volumeUp: string;
  volumeDown: string;
  divider: string;         // the dashed setup/future boundary line
  forecastFill: string;    // wash over the forecast zone
  forecastBorder: string;  // the last-close guide carried across the zone
  forecastText: string;    // the "NEXT n BARS" caption
}

export interface ChartOptions {
  width: number;        // CSS pixels
  height: number;       // CSS pixels
  dpr: number;          // devicePixelRatio; >= 1
  revealCount: number;  // 0 = future hidden; clamped to future.length
  theme: ChartTheme;
}

export function renderChart(
  ctx: CanvasRenderingContext2D,
  setup: readonly Bar[],
  future: readonly Bar[],
  options: ChartOptions,
): void;

export interface ForecastGeometry {
  setupWidth: number;    // CSS px of plot given to the setup
  forecastWidth: number; // CSS px of plot reserved for the forecast zone
  setupSlot: number;     // per-bar pitch inside the setup
  forecastSlot: number;  // per-bar pitch the zone would allow
}

/** Exported so tests and callers can locate the boundary without recomputing it. */
export function forecastGeometry(
  setupCount: number,
  futureCount: number,
  plotWidth: number,
): ForecastGeometry;

export const DEFAULT_THEME: ChartTheme;
```

## Data Model

Owns `ChartTheme` and `ChartOptions`. Consumes `Bar`. Persists nothing.

## Behaviour

### Layout

The canvas is split vertically:

- **Price panel** — top 72% of the height
- **Gap** — 3%
- **Volume panel** — bottom 25%

A right gutter of 44 CSS px is reserved for Y-axis labels in both panels. All
drawing is scaled by `dpr` so the chart is sharp on high-density displays; the
caller sets the canvas backing-store size and `renderChart` applies the transform.

Horizontally the plot is split by `forecastGeometry` into the **setup region** and
the **forecast zone**. The zone takes its natural share,
`plotWidth × future.length / (setup.length + future.length)`, subject to two bounds:

- a **floor of `20 × √future.length` CSS px**, because a one-bar horizon is otherwise
  1/61 of the plot and invisible — the question would be unreadable on the chart that
  asks it;
- a **ceiling of half the plot**, so a long horizon on a narrow phone cannot squeeze
  the setup the user is meant to read.

The floor **grows with the horizon**, and that is the whole point of the `√`. A flat
minimum is worse than the problem it solves: at any floor wide enough to be visible,
both a 1-bar and a 5-bar zone clamp to it and render *identically*, so the width
stops carrying information exactly where the reader most needs it to. `√` lifts the
short horizons clear of invisible while landing almost exactly on the natural width
by the time the horizon is 20, so a long zone stays honestly proportional. At a 356px
plot the three shipped horizons come out **20 / 45 / 89 px** against naturals of
6 / 27 / 89. Zone width is strictly increasing in the horizon at every step from 1
to 20, not just across the shipped three.

Candle body width is derived from the per-bar pitch of its own region, with a 1 px
gap and a minimum of 1 px so a 60-bar 1-minute chart still renders. Future candles
use `min(setupSlot, forecastSlot)` as their pitch, anchored at the boundary: a
widened one-bar zone therefore continues straight on from the last known bar and
shows its surplus as empty space to the right, rather than as a gap in the data or
as one implausibly fat candle.

### Scaling and anonymisation

- The price scale spans `setup` plus the **first `revealCount`** future bars. It
  therefore expands during the reveal. This is acceptable because the reveal happens
  strictly after the answer is committed, so a rescale cannot leak the answer.
- Y-axis labels in the price panel are **percentages relative to
  `setup[setup.length − 1].c`**, which is labelled `0%`. Absolute prices are never
  drawn. This is the render-time half of the anonymisation rule; the build-time half
  is in the data pipeline spec.
- Volume-panel labels use compact notation (`1.2K`, `3.4M`). Volume magnitude does
  not identify an instrument the way price does.
- The X axis carries **no labels at all** — no dates, no times, not even bar indices.
- Future candles are drawn at reduced opacity so the user can see which bars are the
  answer.

### The forecast zone

The horizon is the question, so it is drawn rather than left to the card's text.
Whenever `future.length > 0` — **including while `revealCount` is `0`** — the chart
draws, in this order:

1. a `forecastFill` wash over the whole zone, full canvas height, laid down before
   the grid so gridlines read across it;
2. a dashed vertical boundary in `divider` at the exact start of the zone;
3. a dotted horizontal guide in `forecastBorder` at the last setup close, spanning
   the zone only. This is the level the answer is measured against, so drawing it
   turns "up or down?" into a question about a line the user can see;
4. a two-line caption in `forecastText`: `NEXT` over `n BAR` / `n BARS`. Centred in
   the zone when the measured text fits inside it, otherwise anchored to the plot's
   right edge. It is drawn last so revealed candles cannot bury it.

   The caption is measured against the zone, never the other way round: **the
   caption must not be what decides how wide the zone is.** Sizing the zone to fit
   its own label is exactly how the flat minimum above came to erase the difference
   between a 1-bar and a 5-bar horizon.

All four are **neutral greys**. The zone must never carry an up or down colour —
that would put a hint about the answer directly beside the question. The greys also
mean a single `DEFAULT_THEME` reads on both the light and the dark page.

The zone fill uses a `rect` path fill, **not** `fillRect`. `fillRect` means "a bar"
and nothing else, which is what lets the hidden-future test below stay meaningful.

Geometry is identical whether the future is hidden or shown, so revealing slides
candles into a zone that is already there instead of re-laying the chart out
underneath the user.

### Candle rendering

For each bar: a wick from `l` to `h`, and a body from `min(o, c)` to `max(o, c)`,
coloured `up` when `c >= o` and `down` otherwise. A body whose height rounds below
1 px is drawn as a 1 px line so a doji is still visible. Volume bars use
`volumeUp`/`volumeDown` on the same rule.

### Edge cases

- `revealCount` is clamped into `[0, future.length]`. Out-of-range values do not throw.
- `future` may be empty; the chart then renders setup only regardless of
  `revealCount`, and draws no zone and no caption — a setup-only chart must not
  promise a forecast it has no bars for.
- A setup where every bar has the same price gives a zero price range. The scale
  falls back to a symmetric ±1% band around that price so the chart renders a flat
  line rather than dividing by zero.
- Zero total volume cannot occur — the data pipeline rejects such windows — but the
  volume scale still guards against a zero maximum for robustness.
- `width` or `height` of `0` returns immediately without drawing.

### Error handling

No user-facing error surface. `renderChart` never throws on plausible input; the
guards above cover the degenerate cases. An empty `setup` returns without drawing.

## Dependencies

- `src/types.ts` for `Bar`
- Canvas 2D API only. No DOM queries, no `window`, no `requestAnimationFrame` — the
  caller owns the animation loop.

## Testing Notes

Verified for "renders without throwing, at the right dimensions and with the right
call pattern". Pixel comparison is explicitly out of scope — it is brittle and would
not catch anything the rules below miss.

Tests drive a **recording fake** of `CanvasRenderingContext2D` that logs every call,
so assertions can be made about what was drawn without a real canvas.

- Renders without throwing for each timeframe's typical bar count and for
  `revealCount` of `0`, `1`, mid-range, and `future.length`.
- `revealCount` beyond `future.length` and below `0` are clamped, not thrown on.
- Flat series (all bars identical) renders without a division by zero and produces
  a non-empty draw log.
- Empty `setup`, empty `future`, `width: 0`, and `height: 0` each return without
  throwing.
- **Anonymisation regression tests**, the most important ones here:
  - No `fillText` call anywhere in the log matches a date-like or time-like pattern.
  - Every price-panel `fillText` call ends in `%`.
  - No `fillText` call in the price panel contains a raw close value from the input
    bars — feed a setup with a distinctive price such as `61234.5` and assert that
    string appears nowhere in the log.
- With `revealCount === 0`, no **`fillRect`** occurs to the right of the
  setup/future boundary — the future must not be leaked as a faint or clipped shape.
  The zone's own fill, boundary, guide and caption are exempt by construction: none
  of them is a `fillRect`, and none of them is derived from a future bar's values.
- Forecast zone geometry: a one-bar horizon still gets a visible zone, a narrow plot
  keeps most of its width for the setup, and `future.length === 0` gives a zone of
  zero width.
- **Zone width is strictly increasing in the horizon**, at every step from 1 to 20 —
  not merely non-decreasing. The shipped horizons must additionally differ by enough
  pixels for the eye to resolve, and a 20-bar zone must stay within 2 px of its
  natural proportion so the floor cannot inflate long horizons.
- The caption reads `1 BAR` for a one-bar horizon and `n BARS` otherwise, and is
  absent entirely when there is no future.
- Setup candle x-coordinates are byte-identical between `revealCount: 0` and a full
  reveal — the regression test for "the chart must not reflow under the user".
- `dpr` of `2` scales the transform; the draw log's coordinates differ from `dpr: 1`
  as expected.

## Open Items

None.
