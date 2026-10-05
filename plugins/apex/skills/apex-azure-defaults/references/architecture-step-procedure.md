<!-- ref:architecture-step-procedure-v1 -->

# Architecture Step Procedure

Detailed Step 2 procedure moved from the Architect agent. The agent body keeps
the role, WAF/pricing gates, approval policy, stop rules, and output contract.
Load this reference when authoring the architecture artifact, SKU manifest rev 2,
cost evidence, charts, reviews, or approval panel.

## SKU Manifest — Step 2 Authoring (Bulk Population)

`agent-output/{project}/sku-manifest.{json,md}` already exists from Step 1
(may have empty `services[]` if the user had no hard pins). Step 2 is when
the bulk is authored.

**Authoring workflow**:

1. **Build `candidate_sets[]`** — for each creative SKU decision (App
   Service plan, VM, SQL, Cosmos, AKS pools, Redis, APIM, App Gateway,
   Storage replication), enumerate 2–3 viable SKUs across base + per-env
  shapes only when a genuine choice exists. Exclude tiers that violate required capabilities or user pins
  before pricing; record rejection reasons without requesting irrelevant rates. If one tier is forced,
  document why and include it in the confirmed full estimate; do not invent alternatives to satisfy a count.
2. **Call `cost-estimate-subagent` in `candidate_sets[]` mode** to price
  A-vs-B _before_ committing. This comparison-only mode does not require SKU
  approval and cannot write back the manifest or count as approved pricing.
  Preserve user pins; a worker's cheapest candidate is advice, not an approved choice.
3. **Pick winners** for each decision; never change user-pinned entries
   (`source: user-pin`) — they are locked.
4. **Compute `sla_achieved`** from SKU baseline SLA + zonal + region
   (single-region vs paired-region) per Microsoft's SLA composer rules.
5. **Write rev 2** to `sku-manifest.json` with new entries:
   `source: "architect-derived"`, `source_step: "2"`,
   `last_modified_rev: 2`. Append to `revisions[]`.
6. **Obtain current SKU confirmation, then invoke `cost-estimate-subagent` in `manifest_path` mode** so
   it patches `cost_estimate_monthly_usd` per service via
   `manifest_writeback[]`. Do **not** type prices yourself.
7. The summary SKU table in `02-architecture-assessment.md` (the existing
   `## 📦 Resource SKU Recommendations` H2) is **kept** — render it from
   the manifest. The manifest is the source; the H2 is the rendering.
8. Set `decisions.sku_manifest_status = "reviewed"` and
   `decisions.sku_manifest_revision = 2` via `apex/decide`.
9. **Render the MD view** via
   `node tools/scripts/render-sku-manifest-md.mjs <project>`. The
   renderer is the only legitimate writer of
   `agent-output/{project}/sku-manifest.md`; agents MUST NOT hand-edit
   that file. The renderer fails hard if MD's "Current revision" cell
   does not match JSON `current_revision` — surface any non-zero exit
   to the user.

**Out of scope for `services[]`**: bandwidth, Log Analytics, vnet,
subnet, NSG, route table, public IP, diagnostics. These remain in the
architecture assessment narrative but never enter the manifest. See
[`.github/instructions/sku-manifest.instructions.md`](../instructions/sku-manifest.instructions.md).

**Trade-off matrix lives elsewhere**: `03-des-sku-comparison.md` remains
the WAF trade-off matrix per the existing `▶ Compare SKU Options`
handoff. The manifest is the _decision record_, not the comparison.


## DO / DON'T

### DO

- Search current Microsoft docs for every Azure service, score all WAF pillars
  with confidence, and include Service Maturity.
- Delegate every price to `cost-estimate-subagent`; always produce
  `03-des-cost-estimate.md` plus required WAF/cost charts.
- Ask for missing critical requirements before scoring.
- Hand off only after Approval Gate, using the graph-selected owner: optional
  Design, IaC Planner for governance-first, or Governance for legacy.
- Present approval findings one question per finding; do not combine them into
  a `multiSelect`.
- Match the artifact template exactly, including TOC, navigation, badges,
  Mermaid overview, traffic-light indicators, and `<details>` blocks.
- Update `agent-output/{project}/README.md` with Step 2 artifacts.

### DON'T (non-obvious pitfalls only)

- Do not hardcode prices — all dollar amounts come from `cost-estimate-subagent` responses
- Do not recommend deprecated services — check `apex-azure-defaults` Deprecated Services table
- Do not use GRS with GDPR single-region constraints — use ZRS when data residency prohibits cross-region transfer
- Do not claim zone redundancy without SKU verification (e.g., APIM Standard v2 does NOT support AZ)
- Do not skip memory reservation in capacity sizing — Azure Managed Redis reserves ~20%
- RPS calculation: `monthly_txn / (days × hours × 3600)`. Apply 3-5× concentration for peaks
- **Do not re-create artifacts with `create_file` to apply revisions.**
  First-time creation uses `create_file`; every subsequent revision
  (challenger fixes, per-finding Apply/Skip/Defer decisions) uses available
  editing tools for minimal verified edits, preserving user work. See
  apex-azure-artifacts skill "Revision Workflow".


## Core Workflow

### Terraform-Specific WAF Notes

When `iac_tool: Terraform` is present, keep the artifact structure but note
remote Azure Blob state with locking, `azurerm` pinning, backend storage,
`random_suffix` naming, and AVM-TF availability or gaps.

### Steps

1. **Read requirements and governance** — Parse `01-requirements.md` for scope, NFRs,
   compliance and `iac_tool`; on governance-first projects also read
   `04-governance-constraints.json` before scoring.
2. **Search docs** — Query unresolved service/pattern claims using
  [bounded research](../skills/apex-azure-defaults/references/research-workflow.md#bounded-tool-results).
3. **Assess trade-offs** — Evaluate all 5 WAF pillars, identify primary optimization
4. **Compare candidate SKUs** through the manifest authoring workflow above;
  leave committed cost columns blank until SKU confirmation and approved pricing.
5. **Checkpoint to disk** — Save research notes to `agent-output/{project}/02-waf-research.tmp.md`
  (scratch file, deleted after final artifact is generated). Persist sources, findings and unresolved items.
  Writing a summary does not evict previous messages or reduce the next request's input tokens.
   **Checkpoint** (MANDATORY): `apex/checkpoint` with `step: 2`,
   `subStep: phase_2_waf`.
6. **Context checkpoint (MANDATORY)** — Before pricing delegation, summarize the
  research and apply the runtime compression tier appropriate to observed context usage:
   - Write a single concise summary: WAF pillar scores, resource list with SKUs,
     key architecture decisions, compliance requirements from `01-requirements.md`
   - Avoid optional or redundant reads; load missing required phase guidance before using it
   - Reuse current research and requirements. After edits or lost context, recover
     the needed sections from source or `02-waf-research.tmp.md`; do not guess missing constraints
   - Update session state: `sub_step: "phase_2.5_compacted"`
     **Checkpoint** (MANDATORY): `apex/checkpoint` with `step: 2`,
     `subStep: phase_2.5_compacted`.

  If oversized research results remain in context, checkpoint and request `/clear` plus resume on `03-Architect`
  before pricing. The checkpoint name does not prove actual compaction. Resume from saved research and the failed
  boundary without re-running completed discovery; verify freshness and recover only missing evidence.

6a. **SKU confirmation gate (MANDATORY — before committed pricing, after candidate comparison)** — follow the
    protocol in
    [`workflow-gates.md`](../skills/apex-azure-defaults/references/workflow-gates.md#architect-step-2--phase-6a-sku-confirmation-gate).
6b. **VNet planning gate (MANDATORY when trigger contract holds; honor
    `decisions.vnet_planning_mode`)** — follow the protocol in
    [`workflow-gates.md`](../skills/apex-azure-defaults/references/workflow-gates.md#architect-step-2--phase-6b-vnet-planning-gate).
    Append any priced network resources (Bastion / Firewall /
    NAT-Gateway / VPN-Gateway / ER-Gateway / App-Gateway /
    App-Gateway-for-Containers) from `subnet_plan` to the Step 7
    resource_list.
7. **Delegate approved pricing** — Send the confirmed manifest or resource list to `cost-estimate-subagent`;
    receive verified prices. Precondition guard: refuse to invoke unless
    `decisions.sku_confirmation_status == "approved"`.
8. **Generate assessment and policy map** — Save `02-architecture-assessment.md` with
    subagent-sourced prices. When `04-governance-constraints.json` exists, follow
    `policy-map.md`: add `## 🗺️ Policy Map`, write `02-policy-map.json`, and raise
    blocked rows as findings before approval.
    The **WAF Cost** / **WAF Operational Excellence** sections MUST
    contain a "Cost monitoring routing" sub-block as defined in
    [`workflow-gates.md`](../skills/apex-azure-defaults/references/workflow-gates.md#architect-step-2--cost-monitoring-routing-in-artifact)
    (Owner RBAC + Action Group + anomaly + opt-down). Do NOT duplicate
    this prose in 02-Requirements output.
    **Decisions** (MANDATORY): Record key architecture choices:
    `apex/decide` with `decision: <pattern/SKU/trade-off>`,
    `rationale: <why>`, `step: 2`.
9. **Generate cost estimate** — Save `03-des-cost-estimate.md` with
    subagent-sourced prices.
9a. **Budget gate (MANDATORY — after pricing)** — follow the protocol in
    [`workflow-gates.md`](../skills/apex-azure-defaults/references/workflow-gates.md#architect-step-2--phase-9a-budget-gate).
10. **Generate charts** — Read
    `.github/skills/apex-python-diagrams/references/waf-cost-charts.md` and
    produce three matplotlib charts in `agent-output/{project}/`. Each
    `.py` file must import `save_figure` from
    `.github/skills/apex-python-diagrams/scripts/diagram_io.py` so it emits
    paired `.png` + `.svg` siblings:
    - `02-waf-scores.py` → `02-waf-scores.png` + `02-waf-scores.svg` —
      one horizontal bar per WAF pillar, WAF brand colours
    - `03-des-cost-distribution.py` → `03-des-cost-distribution.png` +
      `03-des-cost-distribution.svg` — donut chart of cost categories
    - `03-des-cost-projection.py` → `03-des-cost-projection.png` +
      `03-des-cost-projection.svg` — 6-month bar and trend chart

    Execute each `.py` file and verify both `.png` and `.svg` exist before continuing.

11. **Delegate lint** — Do not invoke `npm run lint:artifact-templates` or
    `markdownlint-cli2` directly against `agent-output/**`. The artifact
    contract is enforced by the lefthook `artifact-validation` pre-commit
    hook and the `10-Challenger` review. See
    [`agent-authoring.instructions.md`](../instructions/agent-authoring.instructions.md#no-direct-markdownlint-on-agent-output-rule).
    11a. **Render SKU manifest MD** — `node tools/scripts/render-sku-manifest-md.mjs <project>`.
    The renderer is the only legitimate writer of `sku-manifest.md`
    and fails hard on `current_revision` mismatch. Surface any
    non-zero exit to the user.
12. **Pricing sanity check** — Verify no dollar figures in your artifacts were
    written from memory (grep for `$` and confirm each matches subagent output)
    **Checkpoint** (MANDATORY): `apex/checkpoint` with `step: 2`,
    `subStep: phase_5_artifact`.
13. **Required reviews** — follow [Adversarial Review](#adversarial-review--1-pass-comprehensive-architecture--1-pass-cost-estimate-default)
  for architecture and the separate cost estimate before presenting final approval.
14. **Approval gate** — follow [Approval Gate](#approval-gate) and resolve blocking findings
  before completion and handoff. Budget or SKU approval alone does not complete Step 2.


## Cost Estimation

> **Read** [`apex-azure-defaults/references/cost-estimate-parent-contract.md`](../skills/apex-azure-defaults/references/cost-estimate-parent-contract.md)
> for the full Pricing Accuracy Gate, the 5-step delegation procedure,
> the MCP-tools table, and the no-parametric-fallback rule. Architect-specific
> usage notes only below.

Use `output_path = agent-output/{project}/02-cost-estimate.json` and
populate **both** `02-architecture-assessment.md` and
`03-des-cost-estimate.md` from the subagent's JSON. Architect's own
analysis remains qualitative only (Strengths/Gaps prose); WAF pillar
prose carries **no dollar figures**.

### What Goes Where

| Artifact                                                       | Pricing Content                      | Source                   |
| -------------------------------------------------------------- | ------------------------------------ | ------------------------ |
| `02-architecture-assessment.md` → Cost Assessment table        | Service / SKU / Monthly Cost         | Subagent response        |
| `02-architecture-assessment.md` → Resource SKU Recommendations | Monthly Est. column                  | Subagent response        |
| `03-des-cost-estimate.md` → all sections                       | Every dollar figure                  | Subagent response        |
| WAF pillar prose (Strengths/Gaps)                              | Qualitative only — NO dollar figures | Architect's own analysis |

## Adversarial Review — 1-Pass Comprehensive Architecture + 1-Pass Cost Estimate (default)

After generating the assessment and cost estimate, run adversarial reviews.
Read `apex-azure-defaults/references/adversarial-review-protocol.md` for the
lens table, compact prior_findings guidance, and invocation template.

**Default flow (always run)**: 1× `comprehensive` review of the
architecture artifact + 1× `cost-feasibility` review of the cost-estimate
artifact, in parallel. No tier-driven multi-pass auto-fires.

**Deep-review opt-in**: if `decisions.review_depth == "deep"`, enter the
opt-in rotating-lens cascade defined in
`adversarial-review-deep.md` (sibling of `adversarial-review-protocol.md`).
Use the recommended shape from `opt_in_matrix` for the architect's step
in `workflow-graph.json` based on `decisions.complexity`. Do NOT prompt
the user — the project-scoped `review_depth` decision is the opt-in
trigger.

### Gated review request template

For each required gated review:

1. Call `apex/reviewRequest` with `step: 2` and the correct `artifact`.
2. Call `task` with `agent_type: rubber-duck` and the returned `prompt`
   exactly as given. Do not edit, wrap or summarize it.
3. Call `apex/recordReview` with the returned `nonce`; pass `transcript`
   only when the tool reports several captured answers, and `expectedSha`
   only when replacing an earlier findings file after revisions.
4. Present the compact returned findings summary. Read full details only
   when needed for the Gate presentation.

### Architecture Review (default: 1 pass, comprehensive)

Call `apex/reviewRequest` with `artifact: architecture`.

### Cost Estimate Review (1 pass — cost-feasibility lens)

Call `apex/reviewRequest` with `artifact: cost-estimate`.

`apex/recordReview` writes the matching `challenge-findings-*.json`
sidecar. Agents never hand-write findings JSON.

> Note: `cost-estimate-subagent` is **not** invoked for this review — it
> remains the cost-BREAKDOWN emitter consumed earlier in the workflow.
> The cost-audit findings come from the `rubber-duck` review request for
> `artifact: cost-estimate`.

### Parallel Execution Strategy

Before dispatch, follow [review input finalization](../skills/apex-azure-defaults/references/adversarial-review-protocol.md#review-input-finalization).
Finalize and validate both documents first; do not write either target or shared evidence while reviewers run.
Approval and review-status changes belong in recall, decision sidecars, README and handoff, not reviewed documents.
Pass `supporting_paths` with the actual COMPLETE worker JSON and its referenced evidence paths to both reviewers.
Use the recorded successful output path even when versioned; never infer success from a conventional filename.

> **Architecture comprehensive review** and **Cost Estimate review** are
> independent. Request both review prompts with `apex/reviewRequest`,
> dispatch both `rubber-duck` tasks in parallel, then call
> `apex/recordReview` for each nonce before proceeding to the approval gate.

**Checkpoint** (MANDATORY) after each pass:
`apex/checkpoint` with `step: 2`, `subStep: phase_6_challenger_pass{N}`.

### Deep-review path (opt-in, when `decisions.review_depth == "deep"`)

Replace the single comprehensive architecture pass with the rotating-lens
cascade. Per-pass overrides only — every other parameter follows the
review request template above.

1. Pass 1 — `security-governance` (always)
2. Pass 2 — `architecture-reliability` (skip if pass 1 has 0 `must_fix` AND <2 `should_fix`)
3. Pass 3 — `cost-feasibility` (skip if pass 2 has 0 `must_fix`)

Use `apex/reviewRequest` with `artifact: architecture`; for additional
rotating-lens passes, set `kind: deep` and `pass: 2` or `pass: 3` as
appropriate. The canonical architecture review remains pass 1.

### Cost-feasibility review gate + Challenger empty-output diagnostic

Follow the protocols in
[`workflow-gates.md`](../skills/apex-azure-defaults/references/workflow-gates.md#architect-step-2--cost-feasibility-review-gate)
and
[`workflow-gates.md`](../skills/apex-azure-defaults/references/workflow-gates.md#challenger-empty-output-diagnostic--bounded-retry).

## Approval Gate

Full gate mechanics (findings table render, source-merge order,
sidecar location, Revise loop using available editing tools,
Proceed handoff template, banned-phrases enforcement) live in
[`workflow-gates.md`](../skills/apex-azure-defaults/references/workflow-gates.md#architect-step-2--approval-gate-handoff-template).
Architect-step-2 specifics only below.

1. Print WAF pillar scores (Security, Reliability, Performance, Cost,
   Operations) with estimated monthly cost and Policy Map blocked-row count.
2. Print findings as a **multi-line markdown table** per pass (must_fix →
   should_fix → suggestion) using the format in
   [adversarial-review-protocol.md § Findings Table Rendering Format](../skills/apex-azure-defaults/references/adversarial-review-protocol.md#findings-table-rendering-format).
   Then run the **Per-Finding Decision Protocol** from
   [`adversarial-review-protocol.md`](../skills/apex-azure-defaults/references/adversarial-review-protocol.md).
  Use one batched `vscode_askQuestions` panel with a separate question per
  actionable finding, canonical action options, and individual rationales.
  Preserve the protocol's panel cap and resume behavior; never combine
  multiple findings into one `multiSelect` question.
3. Source-merge order for the panel: `challenge-findings-cost-estimate.json`
   → `challenge-findings-architecture.json` (default single-pass) **or**
   `challenge-findings-architecture-pass{1,2,3}.json` (deep-review path;
   omit passes that did not run).
4. Sidecar: `agent-output/{project}/challenge-findings-architecture-decisions.json`.
   All decisions across cost-estimate and architecture passes land here
   — `artifact_type: "architecture"`.
5. **On Revise**: apply accepted edits with available editing tools, preserving
  unrelated user work; validate the changed outputs. Do not recreate existing
  files with `create_file`. Then re-run all relevant passes (`overwrite: true`)
  with prior findings/dispositions and rebuild the panel. Reuse decisions only for unchanged issues and mitigations;
  prior acceptance is not remediation. Keep unchanged reviews only when all their inputs remain current.
6. **On Proceed**: routing is **always** Design or Governance, never
   IaC Planner directly (enforced by `validate-banned-phrases.mjs`).
  Verify both current reviews and the policy-map gate before completion; record human approval outside reviewed documents.
  Never edit a status badge, review table or approval checkbox in those documents after review to close the gate.

