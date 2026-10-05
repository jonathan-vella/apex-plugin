<!-- ref:as-built-step-procedure-v1 -->

# As-Built Step Procedure

Detailed Step 7 procedure moved from the As-Built agent. The agent body keeps
the role, scope, stop rules, output contract, and renderer requirements. Load this
reference for detailed evidence gathering, drift checks, rendering, cost, query,
finalization, updates, and validation.

## DO / DON'T

**Do:**

- Read the prior artifacts and current deployment evidence required for each requested output;
  recover missing rationale from its source, not from a checkpoint or live resource shape
- Query deployed Azure resources for real state (not just planned state)
- Delegate pricing to `cost-estimate-subagent` for as-built cost estimates
- Call `apex/renderDocument` for covered docs and pass only narrative slots
- Verify rendered Mermaid blocks use the same structured data as the tables
- Keep architecture-focused narrative in prose; keep SKU, tier, node count, and
  low-value operational detail in Step 7 tables instead of diagram labels
- Match H2 headings from apex-azure-artifacts templates exactly
- Include attribution headers from template files
- Update README with actual scope/status; only the validated full suite completes Step 7
- Cross-reference deployment summary for actual resource names and IDs

**Avoid:**

- Modifying any Bicep templates, Terraform configurations, or deployment scripts
- Deploying or modifying Azure resources
- Skipping reading prior artifacts — they are your primary input
- Using planned values when actual deployed values are available
- Presenting resources that failed deployment as deployed rather than documenting the gap
- Using H2 headings that differ from the templates
- Letting the as-built diagram sprawl across unused canvas or devolve into low-level wire tracing
- Shrinking service boxes or labels until actual deployed names become hard to read
- Packing tiles with inventory-style configuration detail that belongs in
  `07-resource-inventory.md` instead of the diagram
- Letting same-row support cards drift in size or vertical alignment, which makes
  the support band look improvised instead of deliberate
- Leaving small free-floating flow labels or awkward detour routes that make the
  deployed diagram feel unfinished or improvised
- **Hardcoding prices** — ALL prices in `07-ab-cost-estimate.md` MUST originate from
  `cost-estimate-subagent` responses
- **Calling ARM MCP pricing tools directly** — delegate all pricing to `cost-estimate-subagent`


## As-Built Diagram Workflow

Use `apex/renderDocument` to embed deterministic Mermaid diagrams in the
renderer-covered Step 7 Markdown documents:

1. Write or refresh `agent-output/{project}/07-resource-inventory.json` from
   Azure Resource Graph using
   `tools/schemas/as-built-resource-inventory.schema.json`.
2. Call `apex/renderDocument` with `documentKind: resourceInventory` to render
   the resource-group/type diagram from the same records as the inventory table.
3. Call `apex/renderDocument` with `documentKind: costEstimate` after
   `07-ab-cost-estimate.json` exists to render the cost distribution Mermaid pie.
4. Call `apex/renderDocument` with `documentKind: complianceMatrix` after
   governance evidence is loaded to render the governance gaps Mermaid pie.

Optional contributor-only Python diagrams may still be generated with
[`apex-python-diagrams`](../skills/apex-python-diagrams/SKILL.md), but they are
not required for Step 7 completion and must not replace the renderer's Mermaid
blocks.

## Prerequisites Check

Before starting, validate these artifacts exist in `agent-output/{project}/`:

The table describes full-suite dependencies. For a partial request, require the
deployment summary and only the predecessor evidence needed by the requested output.

| Artifact                         | Required | Purpose                                                           |
| -------------------------------- | -------- | ----------------------------------------------------------------- |
| `01-requirements.md`             | Yes      | Original requirements                                             |
| `02-architecture-assessment.md`  | Yes      | WAF assessment and decisions                                      |
| `04-implementation-plan.md`      | Yes      | Planned architecture (prose mirror)                               |
| `04-iac-contract.json`           | Yes¹     | Machine-readable plan shape (Wave 1+); preferred over prose       |
| `04-policy-property-map.json`    | Yes¹     | L1m governance attestation                                        |
| `04-environment-manifest.json`   | Yes¹     | Per-environment values (redaction-aware reads only)               |
| `05-iac-handoff.json`            | Yes¹     | CodeGen → Deploy handoff with validation + governance attestation |
| `06-deployment-summary.md`       | Yes      | Deployment results                                                |
| `03-des-cost-estimate.md`        | No       | Original cost estimate                                            |
| `04-governance-constraints.md`   | No       | Governance findings                                               |
| `05-implementation-reference.md` | No       | Bicep validation results (legacy projects only)                   |

¹ Wave 1+/Wave 3+ artifacts. **Prefer reading these over the prose
mirrors** — `04-iac-contract.json` and `05-iac-handoff.json` are
canonical and validator-checked. Fall back to prose only for legacy
projects predating Wave 1.

If `06-deployment-summary.md` is missing, STOP — deployment has not completed.

## Session State

Run `apex/status` with `project` for full project context. Do not read `00-session-state.json` directly.

- **Context budget**: Read `06-deployment-summary.md` + `01-requirements.md` at startup
- **My step**: 7
- **Sub-step checkpoints**: `phase_1_prereqs` → `phase_1.5_compacted` →
  `phase_2_inventory` → `phase_3_docs` → `phase_4_cost` → `phase_5_diagram` → `phase_6_index`
- Checkpoint names are stable aliases: `phase_3_pricing` and `phase_4_cost` refer
  to pricing evidence, `phase_5_diagram` to rendered diagrams, `phase_6_index` to
  final inventory/index checks. Preserve persisted keys; use evidence to resume.
- **Resume**: Use the `apex/status` output to detect resume point from `sub_step`.
  A checkpoint does not prove inventory freshness. Check the current deployment result,
  IaC handoff, and live resource evidence before reusing `07-resource-inventory.md`.
  On a new chat, re-query the target resources and compare IDs, provisioning state,
  and actual SKUs with the saved inventory; check that the IaC handoff still matches
  the deployed source. Missing or inconsistent evidence prevents marking the phase current.
  If inputs changed, refresh affected inventory and documentation rather than skipping the phase.
- **Checkpoints**: `apex/checkpoint` with `step: 7`, `subStep: <phase_name>`
- **Decisions**: `apex/decide` with `decision`, `rationale`, and `step: 7`
  Record: documentation scope decisions, resource inventory inclusions/exclusions.
- **On full-suite completion only**: `apex/completeStep` with `step: 7`

## SKU Manifest — Bidirectional Drift Detection

After deployment, `08-As-Built` is responsible for closing the loop:

1. Load `agent-output/{project}/sku-manifest.json` `services[]`.
2. For each `(id, env, region)`, query the deployed Azure resource (via
   `az resource show` / Resource Graph) and read the live SKU.
3. Populate `services[].actual_sku.{env}.{region}` with the observed value.
4. Cross-check against IaC source (Bicep templates / Terraform state) so
   drift is detected in **three directions**:
   - manifest ↔ Azure live
   - manifest ↔ IaC code
   - IaC code ↔ Azure live
5. Emit one finding per mismatch via `apex/finding`. Reference the
   manifest `id` and which directions diverged.
6. Set `decisions.sku_manifest_status = "drift"` if any mismatch exists,
   otherwise leave `deployed`.
7. Append a new manifest revision (`agent: "08-As-Built"`, `step: "7"`)
   capturing the `actual_sku` writes. **Do not change `services[].size`
   or `services[].source`** — drift is reported, not auto-healed.
8. The `07-resource-inventory.md` H2 table includes the `actual_sku`
   column per env/region rendered from the manifest.

## Core Workflow

### Phase 1: Context Gathering

Apply the **Predecessor Artifact Read Policy** below — do not default to
"read all 01–06 in full". Compression tiers come from
`.github/skills/apex-context-management/SKILL.md` (Mode A).

| Artifact                            | Read mode             | Why                                                              |
| ----------------------------------- | --------------------- | ---------------------------------------------------------------- |
| `01-requirements.md`                | summarized (Mode A)   | Need scope + NFRs only; decisions live in apex            |
| `02-architecture-assessment.md`     | summarized (Mode A)   | Cross-check WAF scores + cost baseline; not the source of truth  |
| `03-des-*.md`                       | skip unless ADR cited | Fetch a specific ADR only if `04-implementation-plan.md` cites it |
| `04-governance-constraints.md`      | summarized (Mode A)   | Use JSON below; prose only for narrative compliance matrix       |
| `04-governance-constraints.json`    | **full**              | Drives `07-compliance-matrix.md` rows directly                   |
| `04-implementation-plan.md`         | **full**              | Canonical planned→deployed mapping for `07-design-document.md`   |
| `04-iac-contract.json`              | **full** (Wave 1+)    | Machine-readable plan shape; prefer over prose mirror            |
| `05-implementation-reference.md`    | summarized (Mode A)   | Validation results only; skip entirely for non-legacy projects   |
| `05-iac-handoff.json`               | **full** (Wave 3+)    | CodeGen → Deploy handoff + governance attestation                |
| `06-deployment-summary.md`          | **full**              | Actual deployed state — primary truth for resource inventory    |
| `sku-manifest.json`                 | **full**              | Small; required for bidirectional drift detection                |

Then continue:

1. **Read IaC source** — determine IaC tool from `01-requirements.md` (`iac_tool` field):
   - **Bicep path**: Read templates from `infra/bicep/{project}/` for resource details
   - **Terraform path**: Read configurations from
     `infra/terraform/{project}/` and run `terraform output -json`
     for deployed resource attributes
2. **Query deployed resources** via Azure CLI / Resource Graph for actual state
3. **Read deployment summary** for resource IDs, names, and endpoints

### Phase 1.5: Context Compaction

Apply Mode A runtime compression according to observed context usage per
[`apex-context-management/SKILL.md`](../skills/apex-context-management/SKILL.md):
write one concise summary (resource inventory with IDs/SKUs,
architecture decisions + WAF scores, deployment result, compliance
requirements, cost estimate baseline). Avoid optional or redundant reads;
load missing required phase guidance before using it. Retrieve current resource
details through Azure CLI and recover missing historical decisions from the
appropriate source sections; a live resource query cannot recover design rationale.

**Checkpoint** (MANDATORY): `apex/checkpoint` with `step: 7`, `subStep: phase_1.5_compacted`

### Phase 2: Documentation Generation

Checkpoint `phase_2_inventory` only after current inventory has been produced or verified.

For the full suite, generate in the following dependency order. Partial requests
select only the required rows; do not generate unrelated artifacts. Finalize the
documentation index after charts and diagrams so it includes every produced sibling.

| Order | File                        | Content                                                     |
| ----- | --------------------------- | ----------------------------------------------------------- |
| 1     | `07-resource-inventory.json` | Structured Azure Resource Graph inventory                  |
| 2     | `07-resource-inventory.md`  | Render with `apex/renderDocument`                           |
| 3     | `07-design-document.md`     | Architecture decisions and rationale                        |
| 4     | `07-ab-cost-estimate.json`  | Pricing evidence from `cost-estimate-subagent`              |
| 5     | `07-ab-cost-estimate.md`    | Render with `apex/renderDocument`                           |
| 6     | `07-compliance-matrix.md`   | Render with `apex/renderDocument`                           |
| 7     | `07-backup-dr-plan.md`      | Backup, DR, and business continuity                         |
| 8     | `07-operations-runbook.md`  | Day-2 operations, monitoring, troubleshooting               |
| 9     | `07-documentation-index.md` | Index of all project artifacts with links                   |

## Cost Estimation (07-ab-cost-estimate.md)

> **Read** [`apex-azure-defaults/references/cost-estimate-parent-contract.md`](../skills/apex-azure-defaults/references/cost-estimate-parent-contract.md)
> for the full Pricing Accuracy Gate, the 5-step delegation procedure,
> the MCP-tools table, and the no-parametric-fallback rule. As-built-specific
> usage notes only below.

As-built variants of the parent contract:

- **Resource source (step 1)**: query the **actually deployed**
  environment via `az resource list` + Azure Resource Graph — never
  re-use the planned resource list from Step 4.
- **Output path (step 2)**: `agent-output/{project}/07-ab-cost-estimate.json`
- **Checkpoint (step 3)**: `apex/checkpoint` with `step: 7`, `subStep: phase_3_pricing`
- **Cross-check (step 5)**: also compare `monthly_total` against
  `03-des-cost-estimate.md` and note any planned-vs-as-built delta
  in `07-ab-cost-estimate.md`.
- **Markdown render**: after the cost JSON is written, call
  `apex/renderDocument` with `documentKind: costEstimate`. Put planned-vs-as-built
  commentary in a bounded narrative slot; do not hand-write the cost tables.

### Phase 3: Rendered Mermaid Diagrams

The renderer embeds Step 7 Mermaid diagrams in the covered Markdown documents.
Verify each rendered document contains at least one `mermaid` fenced block and
that its reported source SHA-256 values match the structured artifacts used for
the render. Do not require Python, Graphviz, PNG, or SVG output on client
machines.

Optional Python diagrams may be produced for contributors after the Markdown
suite is complete, but they are out of scope for completion and must not be
used as a substitute for renderer-generated Mermaid.

### Phase 5: Finalize

1. **Check scope and inventory** — verify every requested output and rendered sibling.
  For the full suite, verify all Output Contract entries and successful deployment
  evidence before marking README complete. Partial mode records only actual progress.
2. **Delegate lint** — Do not invoke `npm run lint:artifact-templates` or
   `markdownlint-cli2` directly. The lefthook `artifact-validation` pre-commit
   hook and the `10-Challenger` review own the artifact contract (see
   [`agent-authoring.instructions.md`](../instructions/agent-authoring.instructions.md#no-direct-markdownlint-on-agent-output-rule)).
3. **Present summary** — List all generated documents with brief descriptions

**On full-suite completion only** (MANDATORY): `apex/completeStep` with `step: 7`.
Missing or stale required outputs block completion; a subset request is not a full-step pass.

## Resource Query Commands

```bash
# List all resources in the project resource group
az resource list --resource-group {rg-name} --output table > /tmp/{project}-resources.txt && head -50 /tmp/{project}-resources.txt

# Get resource details
az resource show --ids {resource-id} --output json

# Resource Graph query for deployed resources
az graph query -q "resources | where resourceGroup == '{rg-name}' | project name, type, location, sku, properties" > /tmp/{project}-graph.json && head -100 /tmp/{project}-graph.json
```

## Output Files

Use the complete [Output Contract](#output-contract) inventory, including pricing
JSON, rendered Markdown, and any optional contributor-only diagram extras that
were explicitly requested. All paths are under `agent-output/{project}/`.

## Expected Output

List actual produced paths from [Output Contract](#output-contract), not an
abridged tree. In partial mode identify omitted dependencies and remaining full-suite work.

Validation: enforced by the lefthook `artifact-validation` pre-commit hook and
the `10-Challenger` review. Agents do not invoke `npm run lint:artifact-templates`
or `markdownlint-cli2` directly against `agent-output/**` (see
[`agent-authoring.instructions.md`](../instructions/agent-authoring.instructions.md#no-direct-markdownlint-on-agent-output-rule)).

## User Updates

Before the first tool call, say in one sentence what you will do first.
After completing each major phase, provide a brief status update in chat:

- What was just completed (phase name, key results)
- What comes next (next phase name)
- Any blockers or decisions needed

This keeps the user informed during multi-phase operations.

