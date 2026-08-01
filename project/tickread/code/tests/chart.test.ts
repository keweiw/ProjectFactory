import { test, assert, assertEqual } from "./harness.js";
import { renderChart, DEFAULT_THEME } from "../src/chart.js";
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

  // Every bar — wick and body alike — is drawn as a fillRect, so this covers all
  // data drawing. Grid lines and axis labels use other calls and are exempt.
  // 60 of 80 slots are setup, so the boundary sits at 75% of the plot width.
  const boundary = ((opts.width - 44) * 60) / 80;

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
  const boundary = ((opts.width - 44) * 60) / 80;
  const beyond = calls
    .filter((c) => c.method === "fillRect")
    .filter((r) => (r.args[0] as number) > boundary);
  assert(beyond.length > 0, "revealed future bars should be drawn past the boundary");
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
