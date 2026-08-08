import { test, assert, assertEqual, assertClose } from "./harness.js";
import { renderChart, forecastGeometry, DEFAULT_THEME } from "../src/chart.js";
import type { Bar, ChartOptions } from "../src/chart.js";

interface Call {
  method: string;
  args: unknown[];
}

/**
 * Recording stand-in for CanvasRenderingContext2D. Lets the tests assert about
 * what was drawn without needing a real canvas, which node does not have.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const methods = [
    "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "stroke",
    "fill", "fillRect", "strokeRect", "clearRect", "fillText", "setTransform",
    "scale", "translate", "rect", "arc", "setLineDash",
  ];
  const target: Record<string, unknown> = {};
  for (const m of methods) {
    target[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
    };
  }
  target["measureText"] = (t: string) => ({ width: t.length * 6 });
  // Style properties are plain assignable fields on the fake.
  target["fillStyle"] = "";
  target["strokeStyle"] = "";
  target["lineWidth"] = 1;
  target["font"] = "";
  target["textAlign"] = "left";
  target["textBaseline"] = "alphabetic";
  target["globalAlpha"] = 1;
  return { ctx: target as unknown as CanvasRenderingContext2D, calls };
}

function bars(closes: number[], volume = 1000): Bar[] {
  return closes.map((c, i) => ({
    o: i === 0 ? c : closes[i - 1]!,
    h: c + 1,
    l: c - 1,
    c,
    v: volume,
  }));
}

function rising(n: number, start = 100): Bar[] {
  return bars(Array.from({ length: n }, (_, i) => start + i));
}

function options(over: Partial<ChartOptions> = {}): ChartOptions {
  return { width: 400, height: 300, dpr: 1, revealCount: 0, theme: DEFAULT_THEME, ...over };
}

function texts(calls: Call[]): string[] {
  return calls.filter((c) => c.method === "fillText").map((c) => String(c.args[0]));
}

test("renderChart draws something for a normal setup", () => {
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), rising(5, 160), options());
  assert(calls.length > 0, "nothing was drawn");
});

test("renderChart handles every reveal count without throwing", () => {
  for (const revealCount of [0, 1, 3, 5]) {
    const { ctx, calls } = recordingContext();
    renderChart(ctx, rising(60), rising(5, 160), options({ revealCount }));
    assert(calls.length > 0, `reveal ${revealCount} drew nothing`);
  }
});

test("renderChart clamps a reveal count outside the future range", () => {
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), rising(5, 160), options({ revealCount: 99 }));
  const { ctx: ctx2, calls: calls2 } = recordingContext();
  renderChart(ctx2, rising(60), rising(5, 160), options({ revealCount: -4 }));
  assert(calls.length > 0 && calls2.length > 0, "clamping must not stop drawing");
});

test("renderChart survives a completely flat series", () => {
  const { ctx, calls } = recordingContext();
  const flat = bars(new Array(60).fill(100));
  renderChart(ctx, flat, [], options());
  assert(calls.length > 0, "flat series drew nothing");
  for (const c of calls) {
    for (const a of c.args) {
      if (typeof a === "number") {
        assert(Number.isFinite(a), `non-finite coordinate from ${c.method}: ${a}`);
      }
    }
  }
});

test("renderChart returns quietly on degenerate inputs", () => {
  const cases: Array<[Bar[], Bar[], Partial<ChartOptions>]> = [
    [[], [], {}],
    [rising(60), [], { revealCount: 3 }],
    [rising(60), rising(5, 160), { width: 0 }],
    [rising(60), rising(5, 160), { height: 0 }],
  ];
  for (const [setup, future, over] of cases) {
    const { ctx } = recordingContext();
    renderChart(ctx, setup, future, options(over));
  }
});

// --- anonymisation: the rules that make the test meaningful ---

test("renderChart never draws a date or a time", () => {
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), rising(20, 160), options({ revealCount: 20 }));
  const datish = /\d{4}-\d{2}|\d{1,2}:\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/;
  for (const t of texts(calls)) {
    assert(!datish.test(t), `date-like label drawn: ${t}`);
  }
});

test("renderChart never draws an absolute price", () => {
  // A distinctive price that would identify the instrument if it leaked.
  const setup = bars(Array.from({ length: 60 }, (_, i) => 61234.5 + i));
  const { ctx, calls } = recordingContext();
  renderChart(ctx, setup, [], options());
  for (const t of texts(calls)) {
    assert(!t.includes("61234"), `absolute price leaked into a label: ${t}`);
    assert(!t.includes("61,234"), `absolute price leaked into a label: ${t}`);
  }
});

test("renderChart labels the price axis in percent", () => {
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), [], options());
  const priceLabels = texts(calls).filter((t) => t.includes("%"));
  assert(priceLabels.length > 0, "no percentage labels were drawn");
  assert(
    priceLabels.some((t) => t === "0%" || t === "+0.0%" || t === "0.0%"),
    `expected a zero reference label, got ${JSON.stringify(priceLabels)}`,
  );
});

test("renderChart draws nothing past the boundary while the future is hidden", () => {
  const opts = options({ revealCount: 0 });
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), rising(20, 160), opts);

  // Every bar — wick and body alike — is drawn as a fillRect, and nothing else is,
  // so this covers all data drawing. Grid lines, the forecast zone and axis labels
  // deliberately use path fills and strokes instead, and are exempt.
  const boundary = forecastGeometry(60, 20, opts.width - 44).setupWidth;

  const rects = calls.filter((c) => c.method === "fillRect");
  assert(rects.length > 0, "no bars were drawn at all");
  for (const r of rects) {
    const x = r.args[0] as number;
    const w = r.args[2] as number;
    assert(
      x + w <= boundary + 1,
      `a bar was drawn out to x=${x + w}, past the hidden boundary ${boundary}`,
    );
  }
});

test("renderChart draws past the boundary once the future is revealed", () => {
  const opts = options({ revealCount: 20 });
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), rising(20, 160), opts);
  const boundary = forecastGeometry(60, 20, opts.width - 44).setupWidth;
  const beyond = calls
    .filter((c) => c.method === "fillRect")
    .filter((r) => (r.args[0] as number) > boundary);
  assert(beyond.length > 0, "revealed future bars should be drawn past the boundary");
});

test("renderChart keeps a band clear at the top for the caption", () => {
  // The caption is drawn at the top of the plot. If the price scale runs all the way
  // to y=0 the tallest candle lands underneath it, which is what put "NEXT 1 BAR" on
  // top of the candles. Reserving the band fixes every horizon at once.
  for (const horizon of [1, 5, 20]) {
    const { ctx, calls } = recordingContext();
    renderChart(ctx, rising(60), rising(horizon, 160), options({ revealCount: horizon }));
    const tops = calls.filter((c) => c.method === "fillRect").map((r) => r.args[1] as number);
    assert(tops.length > 0, `horizon ${horizon} drew no bars`);
    assert(
      Math.min(...tops) > 26,
      `horizon ${horizon} drew a bar up at y=${Math.min(...tops)}, into the caption's band`,
    );
  }
});

test("renderChart still uses most of the plot for price", () => {
  // The headroom must not quietly squash the chart into a strip.
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), [], options());
  const tops = calls.filter((c) => c.method === "fillRect").map((r) => r.args[1] as number);
  const spread = Math.max(...tops) - Math.min(...tops);
  assert(spread > 100, `the price area collapsed to ${spread}px of a 300px canvas`);
});

// --- the forming bar: what makes a short horizon animate at all ---

/** A future whose first bar has a real body and a real range, so growth is measurable. */
const swing: Bar[] = [
  { o: 160, h: 170, l: 158, c: 168, v: 2000 },
  ...rising(4, 168),
];

/** The topmost pixel any bar is drawn to past the setup boundary. */
function futureTop(revealCount: number): number {
  const opts = options({ revealCount });
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), swing, opts);
  const boundary = forecastGeometry(60, swing.length, opts.width - 44).setupWidth;
  const beyond = calls
    .filter((c) => c.method === "fillRect")
    .filter((r) => (r.args[0] as number) + (r.args[2] as number) > boundary + 1);
  assert(beyond.length > 0, `a reveal of ${revealCount} drew no future bar at all`);
  return Math.min(...beyond.map((r) => r.args[1] as number));
}

test("renderChart draws the bar that is part way through arriving", () => {
  // A fractional count is the whole fix for a one-bar horizon: with whole bars only,
  // the single bar of a 1-bar question can only be absent or finished.
  const opts = options({ revealCount: 0.4 });
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), [swing[0]!], opts);
  const boundary = forecastGeometry(60, 1, opts.width - 44).setupWidth;
  const beyond = calls
    .filter((c) => c.method === "fillRect")
    .filter((r) => (r.args[0] as number) + (r.args[2] as number) > boundary + 1);
  assert(beyond.length > 0, "the only bar of a one-bar horizon never started forming");
});

test("renderChart grows the forming bar out of the previous close", () => {
  const early = futureTop(0.15);
  const middle = futureTop(0.55);
  const late = futureTop(0.95);
  // Canvas y grows downward and this bar rises, so a growing bar reaches ever higher.
  assert(
    early > middle && middle > late,
    `the forming bar did not grow: ${early}, ${middle}, ${late}`,
  );
});

test("renderChart draws only whole bars when the count has no fraction", () => {
  const { ctx, calls } = recordingContext();
  const opts = options({ revealCount: 2 });
  renderChart(ctx, rising(60), swing, opts);
  const boundary = forecastGeometry(60, swing.length, opts.width - 44).setupWidth;
  const beyond = calls
    .filter((c) => c.method === "fillRect")
    .filter((r) => (r.args[0] as number) + (r.args[2] as number) > boundary + 1);
  // Wick, body and volume for each of the two bars, and nothing for a third.
  assertEqual(beyond.length, 6, "an integer reveal must not start a third bar");
});

test("renderChart keeps the price scale still while a bar forms", () => {
  // If the axis rescaled as the bar grew, the whole chart would creep under the
  // reader for the length of the reveal. The scale steps once per bar instead.
  const gridY = (revealCount: number): number[] => {
    const { ctx, calls } = recordingContext();
    renderChart(ctx, rising(60), swing, options({ revealCount }));
    return calls.filter((c) => c.method === "moveTo").map((c) => c.args[1] as number);
  };
  assertEqual(gridY(0.2), gridY(0.9), "the gridlines moved while a single bar was forming");
});

// --- forecast zone: making the prediction horizon visible ---

test("the shaded zone is exactly as wide as the bars it holds", () => {
  // The complaint that prompted this: at a one-bar horizon the grey band was visibly
  // wider than the single candle inside it, so the surplus read as missing data.
  for (const horizon of [1, 5, 20]) {
    const geometry = forecastGeometry(60, horizon, 356);
    assertClose(
      geometry.forecastSlot * horizon,
      geometry.forecastWidth,
      6,
      `horizon ${horizon} leaves shading its bars do not fill`,
    );
  }
});

test("a one-bar forecast is a chunky candle, not a thin one adrift in grey", () => {
  const one = forecastGeometry(60, 1, 356);
  assert(
    one.forecastSlot > one.setupSlot * 2,
    `the single future bar (${one.forecastSlot.toFixed(1)}px) should dominate a setup ` +
      `bar (${one.setupSlot.toFixed(1)}px)`,
  );
});

test("the short-horizon allowance fades as the horizon lengthens", () => {
  // Expressed as a ratio against the setup's own pitch: the allowance exists to
  // rescue a horizon too short to see, so by 5 bars it should be a nudge and by 20
  // it should be gone. A zone that stays inflated at 20 is no longer proportional,
  // which is the honesty the width is there to carry.
  const ratio = (horizon: number): number => {
    const geometry = forecastGeometry(60, horizon, 356);
    return geometry.forecastSlot / geometry.setupSlot;
  };
  assert(ratio(1) > 3, `a single bar needs real room, got ${ratio(1).toFixed(2)}x`);
  assert(ratio(5) < 1.2, `five bars should be near the setup pitch, got ${ratio(5).toFixed(2)}x`);
  assert(ratio(20) < 1.02, `twenty bars should be proportional, got ${ratio(20).toFixed(3)}x`);
  assert(ratio(5) < ratio(1) && ratio(20) < ratio(5), "the allowance must decay");
});

test("forecastGeometry gives a one-bar horizon a visible zone", () => {
  const one = forecastGeometry(60, 1, 356);
  assert(one.forecastWidth >= 16, `one-bar zone was only ${one.forecastWidth}px`);
  assertClose(one.setupWidth + one.forecastWidth, 356, 6, "the zone must not overflow the plot");
});

test("every shipped horizon gets a visibly different zone width", () => {
  // The whole point of the zone is that its width means something. A flat minimum
  // width made a 1-bar and a 5-bar zone render identically, which is worse than no
  // minimum at all — the reader is shown a difference that is not there.
  const one = forecastGeometry(60, 1, 356);
  const five = forecastGeometry(60, 5, 356);
  const twenty = forecastGeometry(60, 20, 356);
  assert(
    one.forecastWidth < five.forecastWidth,
    `one bar (${one.forecastWidth}px) must be narrower than five (${five.forecastWidth}px)`,
  );
  assert(
    five.forecastWidth < twenty.forecastWidth,
    `five bars (${five.forecastWidth}px) must be narrower than twenty (${twenty.forecastWidth}px)`,
  );
  // Differences the eye can actually resolve, not a rounding artefact.
  assert(five.forecastWidth - one.forecastWidth >= 8, "1 vs 5 must differ visibly");
  assert(twenty.forecastWidth - five.forecastWidth >= 8, "5 vs 20 must differ visibly");
});

test("a long horizon stays close to its honest proportion", () => {
  // The floor is there to rescue small horizons, not to inflate large ones.
  const twenty = forecastGeometry(60, 20, 356);
  const natural = (356 * 20) / 80;
  assert(
    Math.abs(twenty.forecastWidth - natural) < 2,
    `twenty-bar zone was ${twenty.forecastWidth}px against a natural ${natural}px`,
  );
});

test("zone width is monotonic across every horizon, not just the shipped three", () => {
  let previous = 0;
  for (let horizon = 1; horizon <= 20; horizon++) {
    const { forecastWidth } = forecastGeometry(60, horizon, 356);
    assert(forecastWidth > previous, `horizon ${horizon} did not grow: ${forecastWidth}`);
    previous = forecastWidth;
  }
});

test("forecastGeometry keeps the setup readable on a narrow plot", () => {
  const cramped = forecastGeometry(60, 20, 60);
  assert(cramped.forecastWidth <= 30, `the zone ate the setup: ${cramped.forecastWidth}px of 60`);
  assert(cramped.setupSlot > 0, "setup slots must stay positive");
});

test("forecastGeometry returns no zone when there is no future", () => {
  const none = forecastGeometry(60, 0, 356);
  assertEqual(none.forecastWidth, 0, "no future means no zone");
  assertClose(none.setupWidth, 356, 6, "the setup takes the whole plot");
  const empty = forecastGeometry(0, 5, 0);
  assertEqual(empty.forecastWidth, 0, "a zero-width plot has no zone");
});

test("renderChart labels and shades the forecast zone before any reveal", () => {
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), rising(5, 160), options({ revealCount: 0 }));
  const drawn = texts(calls);
  assert(drawn.includes("NEXT"), `missing forecast heading, got ${JSON.stringify(drawn)}`);
  assert(drawn.includes("5 BARS"), `missing forecast length, got ${JSON.stringify(drawn)}`);
  assert(calls.some((c) => c.method === "setLineDash"), "missing dashed boundary");
});

test("renderChart writes the one-bar horizon in the singular", () => {
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), rising(1, 160), options());
  assert(texts(calls).includes("1 BAR"), `expected "1 BAR", got ${JSON.stringify(texts(calls))}`);
});

test("renderChart draws no forecast label when there is no future to predict", () => {
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), [], options());
  assert(!texts(calls).includes("NEXT"), "a setup-only chart must not promise a forecast");
});

test("revealing the future does not move the setup candles", () => {
  const xsAt = (revealCount: number): number[] => {
    const { ctx, calls } = recordingContext();
    renderChart(ctx, rising(60), rising(5, 160), options({ revealCount }));
    // Three fillRects per bar — wick, body, volume — so the first 180 are the
    // sixty setup bars whether or not the future has been revealed.
    return calls
      .filter((c) => c.method === "fillRect")
      .slice(0, 180)
      .map((c) => c.args[0] as number);
  };
  assertEqual(xsAt(5), xsAt(0), "the chart reflowed when the future was revealed");
});

test("renderChart scales its geometry by the device pixel ratio", () => {
  const { ctx: c1, calls: a } = recordingContext();
  renderChart(c1, rising(60), [], options({ dpr: 1 }));
  const { ctx: c2, calls: b } = recordingContext();
  renderChart(c2, rising(60), [], options({ dpr: 2 }));
  const scaleCall = b.find((c) => c.method === "scale" || c.method === "setTransform");
  assert(scaleCall !== undefined, "dpr must be applied through the context transform");
  assertEqual(a.length, b.length, "dpr must not change what is drawn, only the transform");
});
