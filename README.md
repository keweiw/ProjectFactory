# ProjectFactory

A reusable multi-agent software development pipeline powered by Claude Code. Install it into any project and let AI agents guide your work from idea to merged code — with you in control at every critical gate.

---

## How it works

ProjectFactory defines a set of AI agents, each with a specific role in the development pipeline. You install the framework into a project once, then trigger agents via GitHub Issue labels. The pipeline runs itself; you only step in at three human approval gates.

```
IDEA
  └─► DESIGN_DRAFT ──► DESIGN_APPROVED        ← you approve
            └─► SPEC_DRAFT ──► SPEC_IN_REVIEW ──► SPEC_APPROVED   ← you approve
                        └─► IN_PROGRESS ──► CODE_REVIEW ──► REVISION
                                    └─► TESTING ──► COMPLETE ──► MERGED  ← you merge
```

### The agents

| Agent | What it does |
|-------|-------------|
| **Design Agent** | Collaborates with you on the high-level design; writes `DESIGN.md` |
| **Architect Agent** | Breaks the design into components; writes a spec file per component |
| **Spec Reviewer Agent** | Reviews specs before you approve them |
| **Coding Agent** | Implements each component from its approved spec |
| **Code Review Agent** | Reviews the implementation and flags issues |
| **Testing Agent** | Verifies the implementation passes tests |

---

## Prerequisites

- [Claude Code CLI](https://claude.ai/code) installed and authenticated
- A GitHub repository for your project
- The Claude GitHub App installed on that repository

---

## Install into a new project

Clone ProjectFactory and run the install script inside your project:

```bash
# from your project root
git clone https://github.com/keweiw/ProjectFactory /tmp/projectfactory
/tmp/projectfactory/install.sh
```

This scaffolds the following into your project:

```
<your-project>/
  .claude/
    commands/
      pf-design.md        ← /pf-design
      pf-architect.md     ← /pf-architect
      pf-spec-review.md   ← /pf-spec-review
      pf-implement.md     ← /pf-implement
      pf-code-review.md   ← /pf-code-review
      pf-test.md          ← /pf-test
    settings.json         ← GitHub label automation hooks
  AGENTS.md               ← placeholder for your project-specific rules
```

---

## Customise for your project

Edit `AGENTS.md` in your project root to add project-specific rules for any agent. Agents load this file automatically alongside their base instructions.

```markdown
## Design Agent
- This is a mobile-first web app; all design decisions must account for small screens.

## Coding Agent
- Language: TypeScript. Formatter: Prettier. No `any` types allowed.

## Testing Agent
- Use Vitest. Minimum 80% branch coverage required.
```

Only include sections for agents that need special rules. Leave out the rest.

---

## Run the pipeline

### Automatic (via GitHub Issue labels)

Once installed, the pipeline is label-driven. GitHub Actions watches for label changes and triggers the right agent automatically.

1. Open a GitHub Issue for your project idea
2. Add the label `design-draft` — the Design Agent starts
3. Review `DESIGN.md` when the label changes to `awaiting-review`
4. Add `design-approved` — the Architect Agent starts writing specs
5. Each component gets its own Issue, moving through labels automatically
6. You step in only to add `approved` labels and to merge the final PR

### Manual (via Claude Code slash commands)

You can also trigger any agent directly from inside Claude Code:

| Command | Triggers |
|---------|----------|
| `/pf-design` | Design Agent |
| `/pf-architect` | Architect Agent |
| `/pf-spec-review` | Spec Reviewer Agent |
| `/pf-implement` | Coding Agent |
| `/pf-code-review` | Code Review Agent |
| `/pf-test` | Testing Agent |

The slash command reads the current GitHub Issue state and picks up from where the pipeline left off.

---

## GitHub Issue label taxonomy

| Label | Meaning |
|-------|---------|
| `design-draft` | Design Agent is working |
| `awaiting-review` | Waiting for human review |
| `design-approved` | Design approved; Architect Agent starts |
| `spec-draft` | Architect Agent writing spec |
| `spec-in-review` | Spec Reviewer Agent reviewing |
| `spec-approved` | Spec approved; Coding Agent starts |
| `in-progress` | Coding Agent implementing |
| `code-review` | Code Review Agent reviewing |
| `revision` | Coding Agent addressing review feedback |
| `testing` | Testing Agent verifying |
| `complete` | Testing passed; ready to merge |
| `changes-requested` | Human requests changes at any gate |

---

## Where state lives

| What | Where |
|------|-------|
| Pipeline status | GitHub Issue labels |
| High-level design | `DESIGN.md` in the repo |
| Component specs | `specs/<component>.md` |
| Implementation summaries | `summaries/<component>.md` |
| Project-specific agent rules | `AGENTS.md` |

Agents are fully isolated — each invocation reads from GitHub Issues and repo files, writes its output back, then exits. No shared memory between agents.

---

## Project board

Each GitHub Issue represents one component moving through the pipeline. Add all Issues to a GitHub Project board named `ProjectFactory` to visualise the full pipeline at a glance.
