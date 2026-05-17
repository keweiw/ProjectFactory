# ProjectFactory — Design Document

**Status:** DESIGN_DRAFT  
**Author:** keweiw  
**Date:** 2026-05-16

---

## Vision

ProjectFactory is a multi-agent software development pipeline. Given a high-level idea, a coordinated set of AI agents guides the work from initial design through specification, implementation, code review, testing, and final merge — with the human staying in control at every critical gate.

---

## Agent Roles

| Agent | Responsibility |
|-------|---------------|
| **Design Agent** | Collaborates with the human on high-level design; produces design documents (MD files) |
| **Architect Agent** | Decomposes an approved design into components; writes a spec MD file per component |
| **Spec Reviewer Agent** | Reviews specs alongside the human before they are approved |
| **Coding Agent** | Implements a component per its approved spec; writes an implementation summary when done |
| **Code Review Agent** | Reviews the implementation; opens a dialogue with the Coding Agent to address issues |
| **Testing Agent** | Derives a test strategy from the spec; verifies the implementation passes |
| **Orchestrator** | Tracks pipeline state via GitHub Issues; routes work to the right agent at the right time |

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
| `DESIGN_APPROVED` | Human approves the design MD via GitHub Issue label |
| `SPEC_APPROVED` | Human (+ Spec Reviewer Agent) approve the spec MD via GitHub Issue label |
| `MERGED` | Human merges the final PR after testing passes |

---

## State & Communication Strategy

**Content lives in the repository (MD files):**
- `DESIGN.md` — this file; high-level design
- `specs/<component>.md` — one file per component spec, written by the Architect Agent
- `summaries/<component>.md` — implementation summary written by the Coding Agent

**Status lives in GitHub Issues:**
- Each component spec = one GitHub Issue
- Issue labels track the current state (e.g., `spec-draft`, `spec-in-review`, `spec-approved`, `in-progress`, `code-review`, `testing`, `complete`)
- The GitHub Project board (`ProjectFactory`) visualizes the pipeline across all components

---

## Approval Mechanism (Semi-Manual)

Human approval at each gate is **label-based**:

1. Agent finishes its work → updates the Issue label to `awaiting-review`
2. Human reviews the linked MD file in the repository
3. Human adds label `approved` (or `changes-requested`) to the Issue
4. Orchestrator detects the label change → routes to the next agent

For the code review phase, the gate maps to a standard **GitHub PR review** (approve / request changes).

---

## Agent Runtime (Selected Approach)

**Phase 1 — Claude Code CLI, locally orchestrated:**

```
GitHub Issue label changes
        ↓
Orchestrator script (Python or PowerShell) polls GitHub API
        ↓
Detects state (e.g., "spec-approved") → invokes:
  claude --print "You are the Coding Agent. Implement spec at specs/<component>.md ..."
        ↓
Agent writes code / MD output, updates Issue label
```

- Runs on the local machine; human controls when agents run
- Each agent = a `claude` CLI invocation with a crafted prompt and relevant MD files as context
- Transparent and easy to debug while the pipeline is being built

**Phase 2 (future) — Claude Code Scheduled/Remote Agents:**  
Once the pipeline is validated locally, the orchestrator logic migrates to cloud-hosted scheduled agents, removing the need for the local machine to be running.

---

## Open Items

- [ ] Define pipeline **Principles** (guiding rules all agents must follow — e.g., "no code without an approved spec", "agents never self-approve their own work")
- [ ] Define spec MD file template (what sections every component spec must contain)
- [ ] Define the orchestrator script structure
- [ ] Decide on GitHub Issue label taxonomy (full list of labels)
- [ ] Decide whether Coding Agent works on a branch per component or a shared feature branch
