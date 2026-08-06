import { test, assert, assertEqual } from "./harness.js";
import { shouldCommit, describeQuestion, formatMetric } from "../src/app.js";
import type { Bar, Question } from "../src/types.js";

function question(over: Partial<Question> = {}): Question {
  const flat: Bar[] = Array.from({ length: 60 }, () => ({
    o: 100, h: 100, l: 100, c: 100, v: 1000,
  }));
  return {
    id: "q",
    assetClass: "equity",
    timeframe: "1d",
    horizon: 5,
    setup: flat,
    future: [{ o: 100, h: 101, l: 99, c: 101, v: 1000 }],
    answer: "up",
    ...over,
  };
}

// --- shouldCommit: the swipe threshold ---

test("shouldCommit ignores a drag that stays under a quarter of the card", () => {
  assertEqual(shouldCommit(74, 300, 0), null, "just under 25%");
  assertEqual(shouldCommit(-74, 300, 0), null);
});

test("shouldCommit accepts a drag past a quarter of the card", () => {
  assertEqual(shouldCommit(-76, 300, 0), "up", "upward drag is up");
  assertEqual(shouldCommit(76, 300, 0), "down", "downward drag is down");
});

test("shouldCommit accepts a fast flick even when it is short", () => {
  assertEqual(shouldCommit(-20, 300, 0.9), "up");
  assertEqual(shouldCommit(20, 300, 0.9), "down");
});

test("shouldCommit ignores a slow flick that is short", () => {
  assertEqual(shouldCommit(20, 300, 0.2), null);
});

test("shouldCommit ignores a zero-height card rather than dividing by it", () => {
  assertEqual(shouldCommit(100, 0, 0), null);
});

// --- describeQuestion: tells the horizon, never the instrument ---

test("describeQuestion names the timeframe, asset class and horizon", () => {
  const text = describeQuestion(question({ timeframe: "1d", assetClass: "equity", horizon: 5 }));
  assert(text.toLowerCase().includes("daily"), text);
  assert(text.toLowerCase().includes("equity"), text);
  assert(text.includes("5"), text);
});

test("describeQuestion uses the singular for a one-bar horizon", () => {
  const text = describeQuestion(question({ horizon: 1 }));
  assert(/next bar/i.test(text), text);
  assert(!/1 bars/.test(text), text);
});

test("describeQuestion covers every timeframe and asset class", () => {
  const timeframes = ["1m", "1h", "1d", "1mo"] as const;
  const classes = ["equity", "etf_index", "future", "crypto"] as const;
  for (const timeframe of timeframes) {
    for (const assetClass of classes) {
      const text = describeQuestion(question({ timeframe, assetClass }));
      assert(text.length > 0, `${timeframe}/${assetClass} produced nothing`);
      assert(!text.includes("undefined"), `${timeframe}/${assetClass}: ${text}`);
    }
  }
});

test("describeQuestion never leaks anything that could be a year", () => {
  for (const timeframe of ["1m", "1h", "1d", "1mo"] as const) {
    const text = describeQuestion(question({ timeframe, horizon: 20 }));
    assert(!/\b(19|20)\d{2}\b/.test(text), `year-like token in: ${text}`);
  }
});

// --- formatMetric: null is not zero ---

test("formatMetric renders an unavailable metric as words, not a number", () => {
  const shown = formatMetric(null, "percent");
  assert(!shown.includes("0"), `null rendered as a number: ${shown}`);
  assert(/not enough|unavailable|n\/a/i.test(shown), shown);
});

test("formatMetric renders a genuine zero as a number", () => {
  assert(formatMetric(0, "percent").includes("0"), "zero percent should show a digit");
  assert(formatMetric(0, "signed").includes("0"), "zero signed should show a digit");
});

test("formatMetric signs a bipolar metric", () => {
  assert(formatMetric(0.42, "signed").startsWith("+"), formatMetric(0.42, "signed"));
  assert(formatMetric(-0.42, "signed").startsWith("-"), formatMetric(-0.42, "signed"));
});

test("formatMetric renders milliseconds as seconds", () => {
  assertEqual(formatMetric(2500, "ms"), "2.5s");
});
