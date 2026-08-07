# Forecast Zone, Ten-Question Rounds, and Sample Finder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make each question's prediction horizon visually obvious, shorten rounds to ten naturally sampled questions, and add a reusable skill that finds reviewable Yahoo candlestick samples.

**Architecture:** Keep forecast geometry and drawing inside the pure canvas renderer, remove runtime answer-balance repair from the deck sampler, and centralize the round size in `DEFAULT_DECK_SIZE`. Add a read-only Python sample selector that reuses `build_deck.py` validation helpers, a TypeScript gallery rendered by the production chart module, and a project-local Agent Skill that orchestrates those tools.

**Tech Stack:** TypeScript 7 strict mode, native Canvas and ES modules, Python 3 standard library, hand-rolled TypeScript harness, `unittest`, static HTTP server, Agent Skills.

---

### Task 1: Draw a Stable Forecast Zone

**Files:**
- Modify: `project/tickread/code/tests/chart.test.ts`
- Modify: `project/tickread/code/src/chart.ts`
- Modify: `project/tickread/specs/chart.md`

**Step 1: Write failing geometry and drawing tests**

Import `forecastGeometry` and add tests that establish these invariants:

```ts
test("forecastGeometry gives one bar a minimum visible zone", () => {
  const one = forecastGeometry(60, 1, 356);
  assert(one.forecastWidth >= 36, `one-bar zone was ${one.forecastWidth}px`);
  assertClose(one.setupWidth + one.forecastWidth, 356, 6);
});

test("forecast zones grow with the horizon", () => {
  const one = forecastGeometry(60, 1, 356);
  const five = forecastGeometry(60, 5, 356);
  const twenty = forecastGeometry(60, 20, 356);
  assert(one.forecastWidth <= five.forecastWidth, "five bars must not look shorter than one");
  assert(five.forecastWidth < twenty.forecastWidth, "twenty bars must look longer than five");
});

test("renderChart labels and shades the hidden forecast zone", () => {
  const { ctx, calls } = recordingContext();
  renderChart(ctx, rising(60), rising(5, 160), options());
  assert(texts(calls).includes("NEXT"), "missing forecast heading");
  assert(texts(calls).includes("5 BARS"), "missing forecast length");
  assert(calls.some((c) => c.method === "setLineDash"), "missing dashed boundary");
});
```

Update the existing hidden/revealed-boundary tests to use `forecastGeometry(...)`
instead of the old `60 / (60 + horizon)` calculation. Add `assertClose` to the
harness imports.

**Step 2: Run the chart suite and verify RED**

Run:

```powershell
tsc -p .
```

Expected: compilation fails because `forecastGeometry` is not exported and the
new theme fields do not exist.

**Step 3: Implement minimal stable geometry**

In `src/chart.ts`, extend `ChartTheme`:

```ts
forecastFill: string;
forecastBorder: string;
forecastText: string;
```

Add defaults that remain legible in light and dark modes, then add:

```ts
export interface ForecastGeometry {
  setupWidth: number;
  forecastWidth: number;
  setupSlot: number;
  forecastSlot: number;
}

const MIN_FORECAST_WIDTH = 36;

export function forecastGeometry(
  setupCount: number,
  futureCount: number,
  plotWidth: number,
): ForecastGeometry {
  if (plotWidth <= 0 || setupCount <= 0 || futureCount <= 0) {
    return { setupWidth: Math.max(0, plotWidth), forecastWidth: 0, setupSlot: 0, forecastSlot: 0 };
  }
  const natural = (plotWidth * futureCount) / (setupCount + futureCount);
  const forecastWidth = Math.min(plotWidth, Math.max(MIN_FORECAST_WIDTH, natural));
  const setupWidth = plotWidth - forecastWidth;
  return {
    setupWidth,
    forecastWidth,
    setupSlot: setupWidth / setupCount,
    forecastSlot: forecastWidth / futureCount,
  };
}
```

Use separate setup and future slot functions. Cap revealed candle width at the
setup candle width so a one-bar forecast does not render as a giant candle. Before
grid and data drawing, fill the forecast zone. Draw a dashed vertical boundary at
its exact start and two compact label lines (`NEXT`, then `N BAR(S)`). Draw the
zone whenever `future.length > 0`, including `revealCount === 0`.

**Step 4: Run chart tests and verify GREEN**

Run:

```powershell
tsc -p .
node dist/tests/run.js
```

Expected: all TypeScript tests pass; the hidden-future test still proves that no
future candle is drawn before reveal.

**Step 5: Update the chart spec and commit**

Document the forecast zone, minimum one-bar width, neutral styling, fixed reveal
geometry, and new theme fields in `specs/chart.md`.

```powershell
git add project/tickread/code/src/chart.ts project/tickread/code/tests/chart.test.ts project/tickread/specs/chart.md
git commit -m "feat: show the prediction horizon on charts"
```

### Task 2: Use Ten Naturally Sampled Questions

**Files:**
- Modify: `project/tickread/code/tests/deck.test.ts`
- Modify: `project/tickread/code/src/deck.ts`
- Modify: `project/tickread/specs/deck.md`

**Step 1: Write failing round-size and natural-sampling tests**

Import `DEFAULT_DECK_SIZE`, add a default-size test, and replace the balancing test:

```ts
test("drawDeck defaults to ten questions", () => {
  assertEqual(DEFAULT_DECK_SIZE, 10);
  assertEqual(drawDeck(fullPool(20), { random: seeded(1) }).length, 10);
});

test("drawDeck does not repair the sampled answer mix", () => {
  const pool = [
    ...Array.from({ length: 10 }, () => question("1d", 5, "up")),
    ...Array.from({ length: 10 }, () => question("1d", 5, "down")),
  ];
  const deck = drawDeck(pool, { size: 10, random: () => 0.999999 });
  assertEqual(deck.every((q) => q.answer === "up"), true);
});
```

**Step 2: Run and verify RED**

Run `tsc -p . && node dist/tests/run.js` using separate PowerShell lines.

Expected: the default-size test reports 20 instead of 10, and the natural-mix test
fails because `repairBalance` swaps in down questions.

**Step 3: Implement ten-question natural sampling**

- Change `DEFAULT_DECK_SIZE` to `10`.
- Delete `repairBalance` and its invocation.
- Remove the now-unused `Direction` import and spare-pool construction.
- Leave offline `build_deck.py::balance_buckets` unchanged.

**Step 4: Run and verify GREEN**

Run:

```powershell
tsc -p .
node dist/tests/run.js
```

Expected: all tests pass.

**Step 5: Update the deck spec and commit**

Change the default to ten, explain that a round covers at most ten of twelve strata,
and remove the runtime balance-repair contract.

```powershell
git add project/tickread/code/src/deck.ts project/tickread/code/tests/deck.test.ts project/tickread/specs/deck.md
git commit -m "feat: shorten rounds to ten natural samples"
```

### Task 3: Update App Copy and the Real-Bank Integration Contract

**Files:**
- Modify: `project/tickread/code/src/app.ts`
- Modify: `project/tickread/code/index.html`
- Modify: `project/tickread/code/tests/integration.ts`
- Modify: `project/tickread/code/README.md`
- Modify: `project/tickread/specs/app.md`
- Modify: `project/tickread/DESIGN.md`

**Step 1: Make integration expectations fail at ten**

Import `DEFAULT_DECK_SIZE` from `deck.ts`, replace literal round totals with that
constant, remove the up/down balance assertion, and require ten distinct strata:

```ts
check(questions.length === DEFAULT_DECK_SIZE, `drew ${questions.length} questions`);
check(strata.size === DEFAULT_DECK_SIZE, `${strata.size} distinct timeframe/horizon strata`);
check(records.length === DEFAULT_DECK_SIZE, `recorded ${records.length} answers`);
check(scorecard.overall.total === DEFAULT_DECK_SIZE, "scorecard counts every answer");
```

**Step 2: Run the HTTP integration test and verify RED**

Compile, start `python -m http.server 8765 --bind 127.0.0.1`, and run
`node dist/tests/integration.js` from another terminal.

Expected before the app/deck implementation is complete: round-size assertions fail.

**Step 3: Remove duplicated round-size literals**

- Import `DEFAULT_DECK_SIZE` into `app.ts`.
- Use it for the approximate historical round count.
- Generate the report note from the constant: `A ${DEFAULT_DECK_SIZE}-question round...`.
- Change `index.html` from “twenty” to “ten”.
- Update README, app spec, and design references from twenty to ten.
- Preserve `MIN_SAMPLE = 8` and all Wilson interval language.

**Step 4: Run integration and verify GREEN**

Expected: the shipped bank draws ten unique questions across ten distinct strata,
the whole round records ten answers, and the report consumes all ten.

**Step 5: Commit**

```powershell
git add project/tickread/code/src/app.ts project/tickread/code/index.html project/tickread/code/tests/integration.ts project/tickread/code/README.md project/tickread/specs/app.md project/tickread/DESIGN.md
git commit -m "docs: align the app with ten-question rounds"
```

### Task 4: Add a Read-Only Yahoo Sample Selector

**Files:**
- Create: `project/tickread/code/scripts/find_samples.py`
- Create: `project/tickread/code/scripts/test_find_samples.py`
- Modify: `project/tickread/code/.gitignore`

**Step 1: Write failing Python unit tests**

Use synthetic cache payloads and `tempfile.TemporaryDirectory`. Cover:

```py
class FindSamplesTests(unittest.TestCase):
    def test_filters_symbol_timeframe_horizon_and_never_balances(self):
        samples = fs.find_samples(
            self.series(), symbol="AAPL", timeframe="1d", horizon=5,
            count=3, seed=7,
        )
        self.assertEqual(len(samples), 3)
        self.assertTrue(all(s["sourceMeta"]["symbol"] == "AAPL" for s in samples))
        self.assertTrue(all(s["horizon"] == 5 for s in samples))

    def test_same_seed_is_deterministic(self):
        first = [s["id"] for s in fs.find_samples(self.series(), count=4, seed=9)]
        second = [s["id"] for s in fs.find_samples(self.series(), count=4, seed=9)]
        self.assertEqual(first, second)

    def test_write_result_uses_requested_output_not_production_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "samples.json")
            fs.write_result([], out, filters={})
            self.assertTrue(os.path.isfile(out))
            self.assertNotIn(os.path.join("code", "data"), os.path.abspath(out))
```

Also test insufficient pools return all available candidates and report their
count; invalid horizon/count arguments return non-zero through `main(argv)`.

**Step 2: Run and verify RED**

Run:

```powershell
python -m unittest test_find_samples
```

Expected: import fails because `find_samples.py` does not exist.

**Step 3: Implement the selector by reusing pipeline helpers**

Implement:

```py
def find_samples(series, *, symbol=None, asset_class=None, timeframe=None,
                 horizon=None, count=12, seed=0):
    candidates = []
    for source, item_symbol, item_class, item_timeframe, bars in bd.expand_series(series):
        if symbol and item_symbol.upper() != symbol.upper():
            continue
        if asset_class and item_class != asset_class:
            continue
        if timeframe and item_timeframe != timeframe:
            continue
        max_gap = bd.gap_threshold(bars)
        horizons = (horizon,) if horizon else bd.HORIZONS
        for item_horizon in horizons:
            for window in bd.slice_windows(bars, item_horizon):
                if bd.reject_reason(window["setup"], window["future"], max_gap):
                    continue
                answer = bd.answer_of(window["setup"], window["future"])
                if answer is None:
                    continue
                candidates.append(to_review_sample(...))
    candidates.sort(key=lambda item: item["id"])
    random.Random(seed).shuffle(candidates)
    return candidates[:count]
```

`to_review_sample` must call `bd.ship_bar` and `bd.question_id`, and add a separate
`sourceMeta` object containing source, symbol, setup start/end ISO timestamps, and
future return percent. Do not add metadata to `setup` or `future` bars.

The CLI accepts `--cache`, `--out`, `--symbol`, `--asset-class`, `--timeframe`,
`--horizon`, `--count`, and `--seed`; defaults to `.samples/samples.json`. It prints
the selected/available counts and an actionable empty-cache message. Add `.samples/`
to `.gitignore`.

**Step 4: Run and verify GREEN**

Run:

```powershell
python -m unittest test_find_samples test_pipeline
python find_samples.py --symbol AAPL --timeframe 1d --horizon 5 --count 6 --seed 7
```

Expected: Python tests pass and `.samples/samples.json` contains six samples without
changing `data/`.

**Step 5: Commit**

```powershell
git add project/tickread/code/scripts/find_samples.py project/tickread/code/scripts/test_find_samples.py project/tickread/code/.gitignore
git commit -m "feat: find candidate questions from Yahoo cache"
```

### Task 5: Render Samples with the Production Chart

**Files:**
- Create: `project/tickread/code/tools/sample-gallery.html`
- Create: `project/tickread/code/tools/sample-gallery.ts`
- Create: `project/tickread/code/tests/sample-gallery.test.ts`
- Modify: `project/tickread/code/tsconfig.json`
- Modify: `project/tickread/code/tests/run.ts`
- Modify: `project/tickread/code/tests/index.html`
- Modify: `project/tickread/code/tests/integration.ts`

**Step 1: Write failing parser/label tests**

Export `parseSampleFile` and `sampleMetadata` from the gallery module. Add malformed
JSON, valid sample, and metadata formatting tests. The parser takes `unknown` and
returns a validated sample array without `any` or unchecked assertions.

**Step 2: Run and verify RED**

Run `tsc -p .`.

Expected: compilation fails because `tools/sample-gallery.ts` and its exports do not
exist.

**Step 3: Implement the gallery**

- Add `tools/**/*.ts` to `tsconfig.json`.
- Validate the generated JSON defensively.
- Fetch `../.samples/samples.json` by default, with an optional `?data=` override.
- Render one canvas card per sample through `renderChart` and `DEFAULT_THEME`.
- Start every card with `revealCount: 0`.
- Toggle to `sample.future.length` on Reveal; only then show `sourceMeta`.
- Resize canvases using device-pixel ratio without changing forecast geometry.
- Keep all asset paths relative.

The HTML supplies gallery layout, status/error text, card templates, and a module
import from `../dist/tools/sample-gallery.js`.

**Step 4: Add the gallery to both test entry points**

Import `sample-gallery.test.js` from `tests/run.ts` and `tests/index.html`. Add
`/tools/sample-gallery.html` and `/dist/tools/sample-gallery.js` to integration
static-asset checks.

**Step 5: Run and verify GREEN**

Compile, run Node tests, generate sample JSON, serve port 8765, and open:

```text
http://127.0.0.1:8765/tools/sample-gallery.html
```

Verify cards show the forecast zone before reveal and source metadata only after
reveal.

**Step 6: Commit**

```powershell
git add project/tickread/code/tools project/tickread/code/tests/sample-gallery.test.ts project/tickread/code/tests/run.ts project/tickread/code/tests/index.html project/tickread/code/tests/integration.ts project/tickread/code/tsconfig.json
git commit -m "feat: preview candidate questions in a gallery"
```

### Task 6: Create and Validate the Sample Finder Skill

**Required skills:**
- `skill-creator`
- `superpowers:writing-skills`
- `superpowers:test-driven-development`

**Files:**
- Create: `.agents/skills/tickread-sample-finder/SKILL.md`
- Create: `.agents/skills/tickread-sample-finder/agents/openai.yaml`

**Step 1: RED — forward-test the workflow without a skill**

Use a fresh subagent with minimal context:

```text
Find six AAPL daily five-bar-horizon candlestick samples for tickread from the local
Yahoo cache. Do not modify the production question bank. Return a browser-viewable
preview and the command needed to reproduce the same samples.
```

Record whether it discovers the correct cache, preserves `code/data/`, applies all
eligibility rules, uses the production renderer, and produces deterministic output.
This is expected to expose missing orchestration before the skill exists.

**Step 2: Initialize the project-local skill**

Run the system `skill-creator/scripts/init_skill.py` with name
`tickread-sample-finder`, output path `.agents/skills`, and these interface values:

```text
display_name=Tickread Sample Finder
short_description=Find reviewable Yahoo candlestick samples for tickread
default_prompt=Find deterministic tickread question samples from Yahoo cache and open the review gallery.
```

Do not add unused `references/`, `assets/`, or bundled scripts; the authoritative
tools live in the project.

**Step 3: Write the minimal skill**

Use only `name` and `description` in SKILL.md frontmatter. The description starts
with `Use when...` and covers requests to find, inspect, preview, or reproduce
tickread/Yahoo candlestick samples.

The body must instruct the agent to:

1. Locate `project/tickread/code` and read its `AGENTS.md` context.
2. Compile with `tsc -p .` if gallery output is missing or stale.
3. Use `scripts/find_samples.py --help` rather than reimplementing window rules.
4. Reuse cache by default; run `fetch_yahoo.py` only when refresh is explicit.
5. Never pass `code/data` as output and never rebuild the bank.
6. Serve the code directory and report the exact gallery URL and reproduction command.
7. Report selected/available counts and any filter shortfall.

Keep SKILL.md under 500 words with a quick-reference command table and common
mistakes section.

**Step 4: Validate structure**

Run `skill-creator/scripts/quick_validate.py` against the skill folder and inspect
`agents/openai.yaml` for agreement with SKILL.md.

Expected: validation succeeds with no frontmatter or naming errors.

**Step 5: GREEN — forward-test with the skill**

Give a fresh subagent the same prompt plus the skill path. Verify it now uses the
finder CLI, avoids network and production writes, produces six deterministic AAPL
daily horizon-5 samples, and returns the gallery URL/reproduction command.

If it still deviates, tighten only the instructions implicated by the failure and
repeat until it complies.

**Step 6: Commit**

```powershell
git add .agents/skills/tickread-sample-finder
git commit -m "feat: add tickread sample finder skill"
```

### Task 7: Full Verification and Documentation Reconciliation

**Files:**
- Modify if needed: `project/tickread/code/README.md`
- Modify if needed: `project/tickread/DESIGN.md`
- Modify if needed: `project/tickread/specs/*.md`

**Step 1: Search for stale contracts**

Run:

```powershell
rg -n "20-question|twenty questions|default 20|balance repair|5 up|5 down" project/tickread
```

Classify legitimate horizon/statistical uses of `20` separately from stale round
size references. Update only stale round contracts.

**Step 2: Run the complete verification chain**

From `project/tickread/code`:

```powershell
tsc -p .
node dist/tests/run.js
python -m unittest discover -s scripts -p "test*.py"
```

Start a hidden local server on port 8765, run
`node dist/tests/integration.js`, then stop the exact process. Generate a six-sample
gallery and confirm both gallery assets return HTTP 200.

**Step 3: Verify repository boundaries**

Run:

```powershell
git diff --check
git status --short
```

Confirm `code/data/` is unchanged, `.samples/` is ignored, no server remains on
port 8765, and unrelated root `.claude/` bootstrap files are not staged.

**Step 4: Commit any final reconciliation**

```powershell
git add <only-reconciled-docs-and-tests>
git commit -m "test: verify forecast zone and sample workflow"
```

**Step 5: Hand off results**

Report the forecast-zone behaviour, ten-question natural sampling, exact test
counts, sample-finder command, gallery URL, skill path, commits, and any remaining
manual browser check.
