<!-- ref:compression-templates-v1 -->

# Compression Templates

Per-artifact compression rules at each tier. H2 sections to keep/drop
and character budget targets.

Kept section names match the H2 headings in `tools/scripts/_lib/artifact-headings.mjs` (emoji omitted).
A qualifier in parentheses keeps only part of a section: `(first paragraph)`, `(first table)` or `(first line)`.
The `apex` MCP server's `artifactSection` tool applies these rows as written; a test checks every name exists.

## 01-requirements.md

| Tier       | Keep H2 Sections                                                                                                                                                      | Budget      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| full       | All                                                                                                                                                                   | No limit    |
| summarized | Project Overview, Functional Requirements, Non-Functional Requirements (NFRs), Compliance & Security Requirements, Regional Preferences, Summary for Architecture Assessment | ~3000 chars |
| minimal    | Project Overview (first paragraph), Summary for Architecture Assessment (first table)                                                                                 | ~500 chars  |

## 02-architecture-assessment.md

| Tier       | Keep H2 Sections                                                                                       | Budget      |
| ---------- | ------------------------------------------------------------------------------------------------------ | ----------- |
| full       | All                                                                                                    | No limit    |
| summarized | Executive Summary, WAF Pillar Assessment, Architecture Decision Summary, Resource SKU Recommendations | ~4000 chars |
| minimal    | Executive Summary (first paragraph), Architecture Decision Summary (first table)                      | ~500 chars  |

## 03-des-cost-estimate.md

| Tier       | Keep H2 Sections                                       | Budget      |
| ---------- | ------------------------------------------------------ | ----------- |
| full       | All                                                    | No limit    |
| summarized | Cost At-a-Glance, Decision Summary, Top 5 Cost Drivers | ~2000 chars |
| minimal    | Cost At-a-Glance (first line)                          | ~200 chars  |

## 04-implementation-plan.md

| Tier       | Keep H2 Sections                                                         | Budget      |
| ---------- | ------------------------------------------------------------------------ | ----------- |
| full       | All                                                                      | No limit    |
| summarized | Resource Inventory, Module Structure, Deployment Phases, Dependency Graph | ~5000 chars |
| minimal    | Resource Inventory (first table), Deployment Phases (first paragraph)    | ~800 chars  |

## 04-governance-constraints.md

| Tier       | Keep H2 Sections                                                         | Budget      |
| ---------- | ------------------------------------------------------------------------ | ----------- |
| full       | All                                                                      | No limit    |
| summarized | Deployment Blockers, Azure Policy Compliance, Required Tags, Network Policies | ~3000 chars |
| minimal    | Deployment Blockers (first table)                                        | ~500 chars  |

## 05-implementation-reference.md

| Tier       | Keep H2 Sections                                                  | Budget      |
| ---------- | ----------------------------------------------------------------- | ----------- |
| full       | All                                                               | No limit    |
| summarized | IaC Templates Location, File Structure, Validation Status, Key Implementation Notes | ~3000 chars |
| minimal    | IaC Templates Location (first paragraph), Validation Status (first line) | ~400 chars  |

## 06-deployment-summary.md

| Tier       | Keep H2 Sections                                     | Budget      |
| ---------- | ---------------------------------------------------- | ----------- |
| full       | All                                                  | No limit    |
| summarized | Deployment Details, Deployed Resources, Outputs (Expected) | ~3000 chars |
| minimal    | Deployment Details (first table)                     | ~300 chars  |

## 07-\* (As-Built Documents)

As-built documents are terminal — they are not loaded by downstream agents.
Compression is only needed when the As-Built agent loads predecessor artifacts.

## General Rules

- When compressing, preserve all **tables** within kept sections (tables are dense)
- Drop **code blocks** first (they are verbose)
- Over budget, each kept section keeps its heading; short sections stay whole and the rest share the remaining
  budget. A cut table keeps its header and at least three rows, then a `…[truncated: …]` marker
- A paragraph is the first block that is not a heading, table or code block (blockquotes count); a line is its
  first line
- Keep **decision rationale** over implementation details
- Keep **resource names and SKUs** over configuration details
- Always preserve the document title (H1) and first paragraph
- At the `minimal` tier, prefer reading `decision_log` from `apex/status`
  over loading full artifact prose for rationale behind prior choices

## Gate-Boundary `/clear` Handoff Contract

VS Code Copilot Chat owns its own conversation history — no agent API
can evict prior turns. The only realistic main-agent input-token
saving comes from a user-driven `/clear` at every Gate boundary,
resumed via `apex/status`. This contract is the headline mechanism for
Plan 01 (token-reduction).

### Required end-of-gate line

When `01-Orchestrator` finishes presenting an **accepted** Gate
(Requirements / Architecture / Governance / Plan / Code / Deploy), the
final assistant message **MUST** end with this line, verbatim — no
paraphrase, no extra punctuation:

```text
Run `/clear`, then switch the chat agent picker to `01-Orchestrator` and send `resume <project>` to continue Step N+1.
```

Substitute the real project name and step number. Place the line as
the very last line of the message, on its own line, after the gate
summary and the handoff button.

> VS Code custom agents activate via the agent picker, not via `@name`
> chat-participant syntax. See
> <https://code.visualstudio.com/docs/copilot/customization/custom-agents>.

### Required precondition: durable checkpoint

The orchestrator **MUST** call
`apex/checkpoint` (and any
remaining `apex/decide` / `apex/completeStep` calls) **before**
emitting the resume line. The user's `/clear` is destructive — any
state not in `apex` state is lost.

### Required resume path

In the new chat the user picks `01-Orchestrator` from the agent picker
and sends `resume <project>`:

1. First tool call: `apex/status`.
2. Loads only the compact handoff JSON (~1–2 KB).
3. Reads `00-handoff.md` only if a gate-specific artifact path is needed.
4. Skips re-reading completed-step artifacts unless the user explicitly
   asks to revisit them.

### Validator

`tools/scripts/validate_orchestrator_handoff.py` parses
`.github/agents/01-orchestrator.agent.md` and asserts the verbatim
resume line is documented in at least one Gate-acceptance context.
Wired into `npm run validate:agents` (hard fail).

### Tradeoff

The user clicks `/clear` and pastes the resume line 3–4 times per
workflow project (once per Gate). Acceptable per the captured user
decision (Plan 01, May 2026). Smoke-run target: post-`/clear` session
begins at ≤45 K input tokens on its first call (per Plan 01 Phase 2a
verification).
