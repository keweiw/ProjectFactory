# AGENTS.md — tickread

Project-specific agent rules. These **override** the root `AGENTS.md`, which
describes the separate ProjectFactory demo project, not this one.

## About This Project

**tickread** is a swipe-based market intuition test served as a static site. See
`DESIGN.md` for the full design. All working files live under
`project/tickread/code/`.

**Tech stack:**
- HTML5, vanilla CSS (no framework)
- TypeScript compiled by `tsc` to native ES modules — `strict` mode, no `any`
- **No npm runtime dependencies.** `typescript` is the only tool, and only at build time.
- Python **standard library only** for the offline data scripts. No pip installs.
- JSON question bank under `code/data/`, committed to the repo

**Runtime has no backend, no API calls, and no secrets.**

---

## Design Agent

- The design is already written to `DESIGN.md` and should not be re-derived.
- Any change to the asset-class × timeframe matrix, the three question-generation
  rules, or the statistical significance rule must be raised with the human — they
  are load-bearing for the product being meaningful rather than a noise generator.

## Architect Agent

- Decompose into the eight modules named in `DESIGN.md` § Runtime Architecture.
  Prefer 6–8 components for this project; the root demo's "3–5" guidance does not apply.
- `src/types.ts` is shared types with no logic — it does not get its own spec.
  **Every interface shared between modules is declared there**, including
  `AnswerRecord` and `QuestionFeatures`, even though the session and persona specs
  are the authority on their shape. This is what keeps the module graph acyclic.
- Files under `code/data/` and `code/scripts/` are build inputs, not components.
  The data pipeline gets **one** spec covering all three Python scripts together.
- Every spec's Interfaces section must give exact TypeScript signatures. The Coding
  Agent must never have to guess a type.
- Name spec files in kebab-case under `project/tickread/specs/`.

## Spec Reviewer Agent

- Verify that `deck`, `session`, `stats`, and `persona` specs describe **no DOM
  access**. If a spec has these modules touching the document, reject it — that
  boundary is what makes the logic testable.
- Check every statistical formula against `DESIGN.md`. Wilson interval bounds and
  the `n ≥ 8 and interval excludes 0.5` rule must match exactly.
- Confirm each persona metric spec states its behaviour when the denominator is
  zero (no volume surges, no down-trend questions, etc.).
- Check the module graph for cycles. The only edge between `session` and `persona`
  is `session` importing `extractFeatures`; if a spec introduces an import back the
  other way, reject it.

## Coding Agent

- TypeScript `strict`, no `any`, no type assertions without a comment justifying them.
- **No npm packages in `code/src/`.** Browser APIs and hand-written code only.
- Python scripts: standard library only. No `requests`, no `yfinance`, no `pandas`.
- The Polygon key is read from the `POLYGON_API_KEY` environment variable. Never
  hardcode it, never log it, never write it to a file, never reference it from `src/`.
- All asset paths in `index.html` and in `fetch` calls must be **relative** — the
  site is served from a subpath on GitHub Pages.
- `tsc` must compile clean before marking an Issue `code-review`.
- Write the implementation summary to `project/tickread/summaries/<component>.md`.

## Code Review Agent

- Confirm the pure modules import nothing from `app.ts` and touch no DOM globals.
- Confirm no absolute paths and no network calls anywhere in `src/`.
- Verify the anonymisation rule holds end to end: no ticker or date can reach the
  rendered chart, and the Y axis is percentage-relative, never absolute price.
- Do not request style changes unless they violate a rule stated in this file.

## Testing Agent

- Use the hand-rolled harness described in `DESIGN.md` § Testing. Both entry points
  must work: `tests/index.html` in a browser and `node dist/tests/run.js`.
- Python scripts are tested with stdlib `unittest`.
- Priority order for coverage: `stats` (interval maths), `persona` (metric edge
  cases and the nine label boundaries), `deck` (stratification and no repeats),
  `session`, then `chart` (renders without throwing only).
- If `tsc` fails, mark the Issue `revision` immediately — do not run tests on
  code that does not compile.
