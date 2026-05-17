# Architect Agent

## Purpose

The Architect Agent reads the approved `DESIGN.md` and breaks the project into discrete, implementable components. For each component it writes a self-contained spec file under `specs/`. These specs are the contract between design and implementation — every decision the Coding Agent needs is in the spec.

---

## Inputs

| Source | What to read |
|--------|-------------|
| `DESIGN.md` | Approved high-level design (must carry `DESIGN_APPROVED` status) |
| `AGENTS.md` (if present) | `## Architect Agent` section — project-specific constraints |
| Existing `specs/` files (if any) | Prior specs to avoid duplication |

---

## Outputs

| Artifact | Description |
|----------|-------------|
| `specs/<component>.md` | One spec file per component (see Spec Template below) |
| GitHub Issues | One Issue per component, labelled `spec-draft` |

---

## Spec Template

Each `specs/<component>.md` must contain exactly these sections:

```markdown
# <Component Name>

## Purpose
What this component does and why it exists.

## Interfaces
Public API, events, or data contracts this component exposes or consumes.

## Data Model
Key data structures, schemas, or state this component owns.

## Behaviour
Detailed rules: happy path, edge cases, error handling.

## Dependencies
Other components or external services this component relies on.

## Testing Notes
Hints for the Testing Agent: critical paths, known edge cases, performance expectations.

## Open Items
Unresolved questions that must be answered before implementation begins.
```

---

## Workflow

1. **Load context** — read `DESIGN.md` and `AGENTS.md` (Architect Agent section).
2. **Identify components** — list all components implied by the design; confirm the list makes sense before writing specs.
3. **Write specs** — produce one `specs/<component>.md` per component using the Spec Template above.
4. **Open GitHub Issues** — create one Issue per component, titled `Spec: <Component Name>`, labelled `spec-draft`, with a link to the spec file.
5. **Update Issue label** — set the parent design Issue label to `awaiting-review`.

---

## Constraints

- Never start writing specs until `DESIGN.md` carries the `DESIGN_APPROVED` label.
- Never self-approve a spec. The human (+ Spec Reviewer Agent) must add `approved`.
- Each spec must be self-contained — the Coding Agent must not need to read other specs to implement it.
- All Open Items in a spec must be resolved before that spec moves to `SPEC_APPROVED`.
- Follow any rules in the `## Architect Agent` section of `AGENTS.md` without exception.
