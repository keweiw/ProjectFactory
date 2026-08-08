import { test, assert, assertEqual } from "./harness.js";
import {
  shouldCommit,
  describeQuestion,
  describeOutcome,
  describeHistory,
  revealTimeline,
  revealDurationMs,
  MIN_REVEAL_MS,
  MAX_REVEAL_MS,
  HOLD_MS,
} from "../src/app.js";
import { formatMetric } from "../src/report-view.js";
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

// --- describeOutcome: the verdict states the answer, not just the score ---

function withMove(answer: "up" | "down", closeAfter: number): Question {
  return question({
    answer,
    setup: Array.from({ length: 60 }, () => ({ o: 100, h: 100, l: 100, c: 100, v: 1000 })),
    future: [{ o: 100, h: 103, l: 99, c: closeAfter, v: 1000 }],
  });
}

test("describeOutcome states which way it actually went", () => {
  assert(/up/i.test(describeOutcome(withMove("up", 102.5), true)), "up answer must say up");
  assert(/down/i.test(describeOutcome(withMove("down", 97.5), false)), "down answer must say down");
});

test("describeOutcome keeps the correct/wrong verdict", () => {
  assert(/^correct/i.test(describeOutcome(withMove("up", 102.5), true)), "a hit reads Correct");
  assert(/^wrong/i.test(describeOutcome(withMove("up", 102.5), false)), "a miss reads Wrong");
});

test("describeOutcome reports the size of the move against the last setup close", () => {
  // 100 -> 102.5 is +2.5%, measured from the last setup bar, not the first.
  assert(describeOutcome(withMove("up", 102.5), true).includes("2.5%"), "expected 2.5%");
  assert(describeOutcome(withMove("down", 97.5), true).includes("2.5%"), "expected 2.5%");
});

test("describeOutcome does not sign the move twice", () => {
  // The direction word already carries the sign; "down -2.5%" would read as a rise.
  const shown = describeOutcome(withMove("down", 97.5), true);
  assert(!shown.includes("-"), `redundant sign in: ${shown}`);
  assert(!shown.includes("+"), `redundant sign in: ${shown}`);
});

test("describeOutcome measures to the last future bar, not the first", () => {
  const q = question({
    answer: "up",
    setup: Array.from({ length: 60 }, () => ({ o: 100, h: 100, l: 100, c: 100, v: 1000 })),
    future: [
      { o: 100, h: 100, l: 94, c: 95, v: 1000 },
      { o: 95, h: 108, l: 95, c: 107, v: 1000 },
    ],
  });
  assert(describeOutcome(q, true).includes("7.0%"), `expected 7.0%, got ${describeOutcome(q, true)}`);
});

test("describeOutcome still returns a verdict when there is no future", () => {
  const shown = describeOutcome(question({ future: [] }), true);
  assert(/^correct/i.test(shown), shown);
  assert(!shown.includes("NaN"), shown);
  assert(!shown.includes("undefined"), shown);
});

test("describeOutcome never leaks a date or an absolute price", () => {
  const q = question({
    answer: "up",
    setup: Array.from({ length: 60 }, () => ({ o: 61234.5, h: 61234.5, l: 61234.5, c: 61234.5, v: 1 })),
    future: [{ o: 61234.5, h: 62000, l: 61234.5, c: 61847.8, v: 1 }],
  });
  const shown = describeOutcome(q, true);
  assert(!shown.includes("61234"), `absolute price leaked: ${shown}`);
  assert(!shown.includes("61847"), `absolute price leaked: ${shown}`);
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

// --- describeHistory: the first line a returning player reads ---

test("describeHistory does not say 'about 1 rounds'", () => {
  const shown = describeHistory(10, 10);
  assert(!/\b1 rounds\b/.test(shown), `plural bug: ${shown}`);
  assert(shown.includes("1 round"), shown);
});

test("describeHistory drops the hedge when the rounds divide exactly", () => {
  // Records are appended a whole finished round at a time, so this is the normal case
  // and "about" would be hedging a number that is not uncertain.
  assert(!describeHistory(30, 10).includes("about"), describeHistory(30, 10));
  assert(describeHistory(30, 10).includes("3 rounds"), describeHistory(30, 10));
});

test("describeHistory hedges only when the division is not exact", () => {
  const shown = describeHistory(25, 10);
  assert(shown.includes("about"), `an inexact count should be hedged: ${shown}`);
});

test("describeHistory counts the answers themselves", () => {
  assert(describeHistory(1, 10).includes("1 answer "), describeHistory(1, 10));
  assert(describeHistory(2, 10).includes("2 answers"), describeHistory(2, 10));
});

test("describeHistory says nothing when there is no history", () => {
  assertEqual(describeHistory(0, 10), "");
});

test("describeHistory survives a degenerate deck size", () => {
  const shown = describeHistory(10, 0);
  assert(shown.length > 0 && !shown.includes("Infinity") && !shown.includes("NaN"), shown);
});

// --- revealTimeline: the sequencing that used to happen off screen ---
//
// The shipped horizons are 1, 5 and 20 bars, so `steps` is only ever one of those
// three. The reveal used to be a fixed budget cut into `steps` whole bars, which
// meant the animation existed at 20, barely existed at 5, and at 1 was a single
// bar forced on at the first frame — no animation at all. Everything below is
// about the count being continuous and the duration following the bar count.

test("revealTimeline draws nothing before the reveal starts", () => {
  assertEqual(revealTimeline(0, 20), { revealCount: 0, done: false });
});

test("revealTimeline eases the first bar in rather than popping it whole", () => {
  const early = revealTimeline(8, 20).revealCount;
  assert(early > 0, "the reveal must have started by the first frame");
  assert(early < 1, `the first bar must still be forming at 8ms, got ${early}`);
});

test("revealTimeline animates a one-bar horizon instead of finishing instantly", () => {
  const first = revealTimeline(8, 1).revealCount;
  assert(first > 0 && first < 1, `a one-bar horizon jumped straight to ${first}`);
  const middle = revealTimeline(revealDurationMs(1) / 2, 1).revealCount;
  assert(middle > first, `the bar stopped growing: ${first} then ${middle}`);
  assert(middle < 1, `the bar was already complete at the midpoint: ${middle}`);
});

test("every shipped horizon gets frames to animate with", () => {
  // The bug the user could see: at 20 bars there were 20 distinct states to watch,
  // at 1 bar there was exactly one. A horizon must never be a single jump.
  for (const steps of [1, 5, 20]) {
    const duration = revealDurationMs(steps);
    const seen = new Set<string>();
    for (let t = 0; t <= duration; t += 16) {
      seen.add(revealTimeline(t, steps).revealCount.toFixed(3));
    }
    assert(seen.size >= 12, `horizon ${steps} only produced ${seen.size} distinct frames`);
  }
});

test("revealTimeline has drawn every bar by the end of its own duration", () => {
  for (const steps of [1, 5, 20]) {
    assertEqual(
      revealTimeline(revealDurationMs(steps), steps).revealCount,
      steps,
      `horizon ${steps} did not finish`,
    );
  }
});

test("revealDurationMs gives a longer horizon more time, within bounds", () => {
  assert(
    revealDurationMs(20) > revealDurationMs(5),
    "twenty bars must not be rushed through the same budget as five",
  );
  assert(revealDurationMs(1) >= MIN_REVEAL_MS, "one bar still needs long enough to be seen");
  assert(revealDurationMs(500) <= MAX_REVEAL_MS, "the reveal must not become a wait");
});

test("revealTimeline is done only after the hold has elapsed", () => {
  const duration = revealDurationMs(20);
  assertEqual(revealTimeline(duration + HOLD_MS - 1, 20).done, false);
  assertEqual(revealTimeline(duration + HOLD_MS, 20).done, true);
});

test("revealTimeline never draws more bars than it was given", () => {
  assertEqual(revealTimeline(revealDurationMs(5) * 4, 5).revealCount, 5);
});

test("revealTimeline advances monotonically", () => {
  for (const steps of [1, 5, 20]) {
    let previous = 0;
    for (let t = 0; t <= revealDurationMs(steps); t += 7) {
      const count = revealTimeline(t, steps).revealCount;
      assert(count >= previous, `reveal went backwards at ${t}ms: ${previous} then ${count}`);
      previous = count;
    }
  }
});

test("revealTimeline survives a question with no future to reveal", () => {
  assertEqual(revealTimeline(50, 0).revealCount, 0);
  assert(revealTimeline(10_000, 0).done, "a futureless question must still finish");
});
