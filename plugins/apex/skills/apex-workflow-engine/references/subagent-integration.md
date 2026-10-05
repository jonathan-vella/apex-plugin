<!-- ref:subagent-integration-v1 -->

# Subagent Integration Matrix

The [workflow graph](../templates/workflow-graph.json) owns review requirements;
current parent frontmatter and worker bodies own permitted calls and outputs.
Discovery does not wire or authorize a call. Read the
[execution contract](execution-subagent.md) before delegating.

- Step 1 requires comprehensive review.
- Step 2 requires architecture review plus separate independent cost-feasibility review in every mode.
  On governance-first projects, the architecture review covers `02-policy-map.json`.
- Step 3 ADR review is opt-in; Step 3.5 governance reconciliation is legacy-only unless there are no constraints.
- Step 4 requires plan review. Deep review at Steps 2 and 4 requires explicit opt-in, never complexity alone.
- Step 5 code review is opt-in; Step 6 has no Challenger review over deployment tool output.
- Cost workers serve Architect and As-Built; validation and preview workers serve their authorized IaC parents.

> [!NOTE]
> **Pricing Accuracy Gate (Steps 2 & 7)**: No agent writes dollar figures from
> parametric knowledge. All prices must originate from `cost-estimate-subagent`
> (Azure Resource Manager MCP). This policy applies to both the Architect
> (Step 2, `03-des-cost-estimate.md`) and As-Built (Step 7, `07-ab-cost-estimate.md`)
> agents. Established after model evaluation found pricing hallucinations
> (see `agent-output/model-eval-scoring.md`).

Extra validation requests still require an authorized caller, suitable phase,
available tools, and all preview/approval gates. Unknown model cost-tier
eligibility is a blocker, not permission to substitute a model.

## Interactive vs Autonomous Delegation

> [!CAUTION]
> Leaf workers cannot ask user questions, manage todos, or call nested agents.
> Return missing-input diagnostics to the parent; never fabricate defaults.

All production main agents, including `10-Challenger`, are human-selected
entry points with `disable-model-invocation: true`. The Orchestrator has
`agents: []` and uses human handoffs only. An allowlist must not override this
boundary. This applies even when all inputs exist and no questions are needed.

If a required reviewer is unavailable, STOP and request a human handoff to
`10-Challenger`; never nest a main-agent wrapper or fabricate inline review.
Missing or empty output permits exactly one identical-input retry, then human
escalation under the [review protocol](../../apex-azure-defaults/references/adversarial-review-protocol.md).

## File-Mode Contract for Subagent Output (Phase 1 of Context-Window Optimization)

`apex/recordReview` and `cost-estimate-subagent` follow a **file-mode
contract**: the review importer or worker writes full structured output to a
resolved path on disk and returns only compact parent context. This keeps parent
agents' context windows small and prevents repeated JSON dumps from bloating
the conversation.

### Path convention

Cost workers still receive `output_path` explicitly. Gated review paths are
resolved by `apex/reviewRequest` and written by `apex/recordReview`; agents do
not invent or guess findings paths.

| Subagent                     | Caller (step)                 | Canonical `output_path`                                                       |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `apex/recordReview`          | Requirements (1)              | `agent-output/{project}/challenge-findings-requirements.json`                 |
| `apex/recordReview`          | Architect (2) — architecture  | `agent-output/{project}/challenge-findings-architecture.json` (default); `architecture-pass{N}` stem for deep |
| `apex/recordReview`          | Architect (2) — cost          | `agent-output/{project}/challenge-findings-cost-estimate.json`                |
| `apex/recordReview`          | IaC Planner (4)               | `agent-output/{project}/challenge-findings-plan.json` (default); `plan-pass{N}` stem for deep |
| `rubber-duck` (ungated)      | Bicep / IaC CodeGen (5) | Inline findings unless an authorized caller supplies an output path           |
| `cost-estimate-subagent`     | Architect (2)                 | `agent-output/{project}/02-cost-estimate.json`                                |
| `cost-estimate-subagent`     | As-Built (7)                  | `agent-output/{project}/07-ab-cost-estimate.json`                             |

Resolve exact filenames through the current reviewer contract and requested mode.
Governance retains its explicit `-pass1` filename on legacy projects. Preserve
historical evidence but never treat a legacy filename alone as proof of a
current valid review.

### Atomic write + refuse-on-exists

The file writer:

1. Writes to `{output_path}.tmp` first.
2. Renames `{output_path}.tmp` → `{output_path}` only after a successful
   complete write. Partial writes never appear under the canonical name.
3. Refuses to overwrite an existing file unless the parent explicitly passes
   `overwrite: true`. This protects against silent loss on retries or
   parallel runs.

### Parent responsibilities

After the review importer or worker returns its compact summary, the parent agent MUST:

1. Avoid pasting the full JSON inline in chat. Read `output_path` from disk
   only when full finding details are needed (e.g., Gate presentation, fix
   triage).
2. Record the artifact in session state via `apex/checkpoint` with `artifact`
   when the owning agent's contract requires it.

3. When re-running after revisions, set `overwrite: true` explicitly.

### Why the contract was flipped

Previously parents wrote the JSON, which forced the worker to return the
full payload via chat. On multi-pass reviews this dumped 5–10 KB of JSON
into the parent's context per pass. The file-mode contract pushes that
weight to disk and replaces it with a 15-line summary, cutting per-turn
context floor on review-heavy steps (2, 4, 5).
