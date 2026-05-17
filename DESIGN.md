# ProjectFactory — Design Document

**Status:** DESIGN_DRAFT  
**Author:** keweiw  
**Date:** 2026-05-16  
**Updated:** 2026-05-17

---

## Vision

ProjectFactory is a reusable multi-agent software development pipeline. Given a high-level idea, a coordinated set of AI agents guides the work from initial design through specification, implementation, code review, testing, and final merge — with the human staying in control at every critical gate.

The framework is **installable into any new project**. Once installed, Claude Code loads it automatically and acts as the orchestrator. Project-specific rules layer on top of the shared agent definitions without modifying the framework itself.

---

## Agent Roles

| Agent | Responsibility |
|-------|---------------|
| **Design Agent** | Collaborates with the human on high-level design; produces `DESIGN.md` |
| **Architect Agent** | Decomposes an approved design into components; writes a spec MD file per component |
| **Spec Reviewer Agent** | Reviews specs alongside the human before they are approved |
| **Coding Agent** | Implements a component per its approved spec; writes an implementation summary when done |
| **Code Review Agent** | Reviews the implementation; opens a dialogue with the Coding Agent to address issues |
| **Testing Agent** | Derives a test strategy from the spec; verifies the implementation passes |

Agent roles are **universal** — the same definitions apply across all projects. Project-specific behaviour is injected via `AGENTS.md` (see below).

---

## Workflow & State Machine

Each unit of work (a component spec) moves through the following states:

```
IDEA
  └─► DESIGN_DRAFT ──► DESIGN_APPROVED        ← human gate
            └─► SPEC_DRAFT ──► SPEC_IN_REVIEW ──► SPEC_APPROVED   ← human gate
                        └─► IN_PROGRESS ──► CODE_REVIEW ──► REVISION
                                    └─► TESTING ──► COMPLETE ──► MERGED  ← human gate
```

### Human Gates
| Gate | Trigger |
|------|---------|
| `DESIGN_APPROVED` | Human approves `DESIGN.md` via GitHub Issue label |
| `SPEC_APPROVED` | Human (+ Spec Reviewer Agent) approve the spec MD via GitHub Issue label |
| `MERGED` | Human merges the final PR after testing passes |

---

## State & Communication Strategy

**Content lives in the repository (MD files):**
- `DESIGN.md` — high-level design, written by the Design Agent
- `AGENTS.md` — project-specific rules per agent role (optional, human-authored)
- `specs/<component>.md` — one file per component spec, written by the Architect Agent
- `summaries/<component>.md` — implementation summary written by the Coding Agent

**Status lives in GitHub Issues:**
- Each component spec = one GitHub Issue
- Issue labels track the current state (e.g., `spec-draft`, `spec-in-review`, `spec-approved`, `in-progress`, `code-review`, `testing`, `complete`)
- The GitHub Project board (`ProjectFactory`) visualizes the pipeline across all components

---

## Project-Specific Customisation — `AGENTS.md`

Each project may contain an `AGENTS.md` file in its root. When an agent is invoked, it loads this file as additional context alongside its base role definition.

`AGENTS.md` is a single file with one section per agent role:

```markdown
## Design Agent
- This project targets mobile-first web apps; all design decisions must consider small screens.

## Architect Agent
- Prefer microservices over monoliths; each component must expose a REST API.

## Coding Agent
- Language: TypeScript. Formatter: Prettier. No `any` types.

## Testing Agent
- Use Vitest. Minimum 80% branch coverage required.
```

Sections are optional — only include roles that need project-specific rules. Agents read their own section and ignore others.

---

## Approval Mechanism (Semi-Manual)

Human approval at each gate is **label-based**:

1. Agent finishes its work → updates the Issue label to `awaiting-review`
2. Human reviews the linked MD file in the repository
3. Human adds label `approved` (or `changes-requested`) to the Issue
4. The next slash command (see Runtime below) picks up the approved state and routes to the next agent

For the code review phase, the gate maps to a standard **GitHub PR review** (approve / request changes).

---

## Agent Runtime

**Claude Code CLI as the orchestrator:**

The framework is distributed as a set of files that install into any project. Once installed, Claude Code loads the pipeline automatically when the project is opened. The human drives state transitions by running slash commands from inside the project directory.

```
Human runs /pf-design (or /pf-architect, /pf-implement, etc.)
        ↓
Slash command resolves repo identity from git remote (automatic)
        ↓
Agent loads: base role prompt + AGENTS.md (if present) + relevant GitHub Issue state + relevant MD files
        ↓
Agent does its work, writes MD / code output, updates GitHub Issue label
        ↓
Agent exits — no shared memory; GitHub Issues + repo files are the only handoff medium
```

**Each agent invocation is isolated:**
- Reads its inputs from GitHub Issues and repo files
- Writes its outputs back to repo files and GitHub Issue labels
- No context bleeds between agents

**Installed framework files:**

```
<project-root>/
  .claude/
    commands/
      pf-design.md          ← /pf-design slash command
      pf-architect.md       ← /pf-architect slash command
      pf-spec-review.md     ← /pf-spec-review slash command
      pf-implement.md       ← /pf-implement slash command
      pf-code-review.md     ← /pf-code-review slash command
      pf-test.md            ← /pf-test slash command
    settings.json           ← hook config (label updates, etc.)
  AGENTS.md                 ← project-specific rules (human-authored, optional)
  DESIGN.md                 ← created by /pf-design
  specs/                    ← created by /pf-architect
  summaries/                ← created by /pf-implement
```

**Installation:**
- Run an install script (or `git clone` the ProjectFactory template) to scaffold the `.claude/` directory into any new project
- `AGENTS.md` is created by the human for each project; all other framework files come from the template

**Phase 2 (future) — Cloud-hosted agents:**  
Once the pipeline is validated, the slash-command orchestration migrates to cloud-hosted scheduled agents, removing the need for the human to manually trigger each step.

---

## Open Items

- [ ] Define pipeline **Principles** (guiding rules all agents must follow — e.g., "no code without an approved spec", "agents never self-approve their own work")
- [ ] Define spec MD file template (what sections every component spec must contain)
- [ ] Define the full GitHub Issue label taxonomy
- [ ] Define the install script / scaffolding mechanism
- [ ] Decide whether Coding Agent works on a branch per component or a shared feature branch
- [ ] Define slash command prompt structure (how each `.claude/commands/pf-*.md` is written)
