# AGENTS.md — ProjectFactory Demo

## About This Project

This project is a **demonstration of the full ProjectFactory agentic development pipeline**. It builds a small static website using HTML, TypeScript, and CSS, backed by JSON data files in `data/`. The codebase is intentionally simple so the focus stays on the pipeline — not the technology.

**Tech stack:**
- HTML5 — page structure
- TypeScript — all logic (compiled to JS; no `any` types)
- CSS — styling (no framework; vanilla CSS only)
- JSON — data files under `data/`
- No backend, no build server — output is static files openable in a browser

**Purpose:** Every agent action in this project is a live example of how ProjectFactory works. Agents should treat this project as both a real deliverable and a reference implementation.

---

## Bootstrap — Before You Begin

**Every agent must do this before starting its work:**

1. Check whether `.claude/roles/` exists in the project root.
2. If it does **not** exist, run the install script from the project root:
   ```powershell
   .\install.ps1 -TargetPath .
   ```
3. Once `.claude/roles/` is confirmed present, load your role profile:
   - Read `.claude/roles/<your-role>.md` in full before proceeding.
   - Your role profile defines your inputs, outputs, workflow, and constraints. Follow it exactly.

If `install.ps1` is not present, the ProjectFactory framework has not been set up correctly — stop and notify the human before proceeding.

---

## Spec Format

Every component spec lives at `specs/<component>.md`. All specs must follow this exact template — no sections may be omitted:

```markdown
# <Component Name>

**Status:** SPEC_DRAFT | SPEC_IN_REVIEW | SPEC_APPROVED
**GitHub Issue:** #<issue number>

## Purpose
What this component does and why it exists in the context of this project.

## Interfaces
Public API, DOM elements, events, or data contracts this component exposes or consumes.
Include function signatures, event names, or JSON field names as appropriate.

## Data Model
Key data structures or JSON schemas this component owns or reads.
Reference files under data/ where applicable.

## Behaviour
Detailed rules covering:
- Happy path (step-by-step what happens under normal conditions)
- Edge cases (what happens when input is missing, malformed, or unexpected)
- Error handling (how failures are surfaced to the user)

## Dependencies
Other components, data files, or browser APIs this component relies on.

## Testing Notes
- Critical paths the Testing Agent must cover
- Known edge cases to test
- Any browser compatibility considerations

## Open Items
Unresolved questions that must be answered before implementation begins.
Mark each with the GitHub Issue comment number where it was raised.
```

---

## GitHub Issue Format

Each component spec maps to one GitHub Issue. Issues must follow this format:

**Title:** `Spec: <Component Name>`

**Body:**
```markdown
## Component
<Component Name>

## Spec File
`specs/<component>.md`

## Status
<!-- Updated by agents via label changes — do not edit manually -->
`spec-draft` | `spec-in-review` | `spec-approved` | `in-progress` | `code-review` | `testing` | `complete`

## Summary
One paragraph describing what this component does.

## Acceptance Criteria
- [ ] <criterion 1>
- [ ] <criterion 2>
```

**Labels:** Use exactly one state label at a time from this taxonomy:

| Label | Meaning |
|-------|---------|
| `spec-draft` | Spec written, not yet in review |
| `spec-in-review` | Spec Reviewer Agent and human are reviewing |
| `awaiting-review` | Agent work done, waiting for human approval |
| `spec-approved` | Human has approved the spec |
| `in-progress` | Coding Agent is implementing |
| `code-review` | Implementation ready for Code Review Agent |
| `revision` | Changes requested; Coding Agent must revise |
| `testing` | Code review passed; Testing Agent is verifying |
| `complete` | All tests pass; ready for human to merge |
| `changes-requested` | Human or reviewer has requested changes |

---

## Design Agent

- The vision for this project: a static website that loads and displays data from `data/*.json` files, with clean navigation and readable layout.
- The design must describe at minimum: the page structure, how data flows from JSON to the UI, and any interactivity.
- Keep the design simple — this is a demo, not a production product. Prefer one or two well-defined components over many small ones.
- Output must be written to `DESIGN.md` in the project root.

---

## Architect Agent

- Decompose the approved design into components that map cleanly to TypeScript modules.
- Each component = one `.ts` file + one spec. Do not create components that are too small to stand alone.
- Prefer 3–5 components for this demo. More than 6 is too many.
- Data files in `data/` are not components — they are inputs. Do not create specs for data files.
- Name spec files in kebab-case: `specs/data-loader.md`, `specs/nav-bar.md`, etc.
- Create one GitHub Issue per spec immediately after writing the spec file.

---

## Spec Reviewer Agent

- Pay particular attention to the Interfaces section — TypeScript types and function signatures must be precise enough for the Coding Agent to implement without guessing.
- Check that every JSON field referenced in the spec exists (or will exist) in `data/`.
- Flag any spec that introduces a browser API not supported in modern browsers without a fallback.

---

## Coding Agent

- Language: TypeScript. No `any` types. Enable `strict` mode in `tsconfig.json`.
- All TypeScript must compile without errors before marking the Issue `code-review`.
- File structure:
  ```
  src/
    <component>.ts    ← one file per component
  data/
    <dataset>.json    ← JSON data files
  index.html          ← entry point
  style.css           ← global styles
  tsconfig.json
  ```
- Do not use any npm packages or external libraries. Vanilla TypeScript and browser APIs only.
- Write the implementation summary to `summaries/<component>.md` before updating the Issue label.

---

## Code Review Agent

- Verify TypeScript strict mode is respected — no implicit `any`, no type assertions without justification.
- Check that the component does not reach outside its defined interface (no hidden coupling).
- Confirm the implementation is openable in a browser without a build server (or that build steps are documented).
- Do not request style changes unless they violate a rule stated in this file.

---

## Testing Agent

- Tests must be runnable without a build server — use browser-native `<script type="module">` or a simple test harness.
- Cover every item in the spec's Testing Notes section, plus all Acceptance Criteria on the GitHub Issue.
- Write test results to `summaries/<component>-test.md`.
- If TypeScript compilation fails, mark the Issue `revision` immediately — do not attempt to run tests on broken code.
