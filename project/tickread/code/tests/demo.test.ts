import { test, assert, assertEqual } from "./harness.js";
import { demoFrame, DEMO_CYCLE_MS } from "../src/demo.js";

// The phases, for reference:
//   settle  0    - 900   candles present, nothing moving
//   poise   900  - 1500  the hand fades in
//   swipe   1500 - 1900  the card lifts
//   reveal  1900 - 2700  the true bars draw
//   rest    2700 - 3600  the answer sits there to be read

test("the demo opens settled with nothing revealed", () => {
  const frame = demoFrame(0, 20);
  assertEqual(frame.phase, "settle");
  assertEqual(frame.revealCount, 0);
  assertEqual(frame.cardOffset, 0);
  assertEqual(frame.direction, null);
});

test("the hand is invisible while the chart is settling", () => {
  assertEqual(demoFrame(200, 20).handOpacity, 0);
});

test("the hand fades in during the poise", () => {
  const frame = demoFrame(1200, 20);
  assertEqual(frame.phase, "poise");
  assert(frame.handOpacity > 0, `expected a visible hand, got ${frame.handOpacity}`);
  assertEqual(frame.revealCount, 0);
});

test("the card is at rest during settle and rest", () => {
  assertEqual(demoFrame(500, 20).cardOffset, 0);
  assertEqual(demoFrame(3000, 20).cardOffset, 0);
});

test("the card lifts upward during the swipe", () => {
  const frame = demoFrame(1700, 20);
  assertEqual(frame.phase, "swipe");
  assert(frame.cardOffset < 0, `expected an upward lift, got ${frame.cardOffset}`);
  assertEqual(frame.direction, "up");
});

test("the card never lifts further than its own height", () => {
  for (let t = 1500; t < 1900; t += 20) {
    const offset = demoFrame(t, 20).cardOffset;
    assert(offset >= -1, `offset ${offset} at ${t}ms is more than one card height`);
  }
});

test("nothing is revealed before the swipe commits", () => {
  assertEqual(demoFrame(1499, 20).revealCount, 0);
});

test("the reveal fills every bar by the end of its phase", () => {
  assert(demoFrame(2300, 20).revealCount > 0, "the reveal should be under way at 2300ms");
  assertEqual(demoFrame(2700, 20).revealCount, 20);
});

test("the reveal advances monotonically", () => {
  let previous = 0;
  for (let t = 1900; t <= 2700; t += 25) {
    const count = demoFrame(t, 20).revealCount;
    assert(count >= previous, `reveal went backwards at ${t}ms: ${previous} then ${count}`);
    previous = count;
  }
});

test("the reveal never exceeds the bars it was given", () => {
  assertEqual(demoFrame(2700, 5).revealCount, 5);
  assertEqual(demoFrame(3200, 1).revealCount, 1);
});

test("the revealed bars stay revealed through the rest", () => {
  assertEqual(demoFrame(3200, 20).revealCount, 20);
  assertEqual(demoFrame(DEMO_CYCLE_MS - 1, 20).revealCount, 20);
});

test("the cycle wraps", () => {
  assertEqual(demoFrame(DEMO_CYCLE_MS, 20), demoFrame(0, 20));
  assertEqual(demoFrame(DEMO_CYCLE_MS + 1700, 20), demoFrame(1700, 20));
  assertEqual(demoFrame(DEMO_CYCLE_MS * 3 + 500, 20), demoFrame(500, 20));
});

test("a horizon of zero bars does not break the reveal", () => {
  assertEqual(demoFrame(2700, 0).revealCount, 0);
});
