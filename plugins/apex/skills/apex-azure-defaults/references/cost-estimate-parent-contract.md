<!-- ref:cost-estimate-parent-contract-v1 -->

# Cost-Estimate Subagent — Parent Contract

Caller-side delegation rules every parent agent that emits dollar
figures MUST follow when invoking
[`cost-estimate-subagent`](../../../agents/_subagents/cost-estimate-subagent.agent.md).
Applies today to [`03-architect`](../../../agents/03-architect.agent.md)
(planned costs) and [`08-as-built`](../../../agents/08-as-built.agent.md)
(as-built costs). Any future agent that surfaces Azure pricing in a
user-facing artifact MUST read this file before invocation.

## Harness Contract

`cost-estimate-subagent` runs on the model selected by the user in the client.
Keep the independently required cost-feasibility review with `apex/reviewRequest`
and the built-in `rubber-duck` reviewer. If the active harness cannot invoke the
declared worker, STOP and notify the user; never substitute a nested main-agent
wrapper or parent-authored prices. Local prompt metadata is not an Agent Host
routing contract; skills run inside the caller's current session and tool scope and
require explicit selection of the owning agent.

---

## Pricing Accuracy Gate (HARD)

Parent-side model evaluation found agents hallucinating Azure SKU prices
(e.g., AKS Standard at $0.60/hr instead of $0.10/hr) when writing from
parametric knowledge. **ALL dollar figures in user-facing artifacts MUST
come from `cost-estimate-subagent` (ARM MCP primary; constrained first-party API evidence fallback).**
Never write a price that did not originate from a subagent response.

## Delegation Procedure (5 steps)

1. **Prepare a resource list** — compile resource types, SKUs, region,
   and quantities from the upstream source, preserving each environment,
   region, and independent stamp plus effective overrides and explicit usage:
   - **03-architect**: from the WAF assessment / sku-manifest.
   - **08-as-built**: from `az resource list` + Azure Resource Graph
     queries against the actual deployed environment (NOT the plan).
    For private networking, follow the
    [Private Endpoint and private DNS recipes](pricing-guidance.md#private-endpoint-and-private-dns-meters).
    Supply endpoint count/hours, inbound/outbound GB with aggregation scope, hosted zone count and monthly DNS queries.
    Capture central/DINE zone ownership and shared-cost allocation; do not assume private traffic is zero because
    internet egress is excluded. Keep the deployment region unchanged; the worker selects the documented billing region.
    Record unknown usage as unresolved or obtain an explicit assumption before invoking; do not invent zero usage.
2. **Check current pricing evidence**, then delegate only when needed.
   Reuse a persisted COMPLETE worker result only after the freshness and
   full-input equivalence checks in [pricing guidance](pricing-guidance.md#evidence-reuse).
   Missing evidence, changed deployment inputs, expiry, or explicit refresh
   requires `cost-estimate-subagent`; never infer current prices from a path
   or restamp reused rates. Reuse preserves the independent cost-feasibility review.
   Invoke with:
   - `resource_list`, `project_name`, `region`
   - `output_path` = `agent-output/{project}/<artifact>-cost-estimate.json`
     (per-agent: `02-cost-estimate.json` for 03, `07-ab-cost-estimate.json` for 08)
   - `overwrite` = `false` (set to `true` only when re-running after revisions)
   - Optional: `compare_regions: true`, `include_ri_savings: true`
   The worker may create request/evidence files under `{output_path}.retail-evidence/` for the
   [constrained direct-API fallback](pricing-guidance.md#constrained-direct-api-fallback).
   Preserve failed attempts and evidence; never instruct the worker to relabel direct API records as MCP output.
   Every prompt to this worker starts with `APEX-CALLER: <calling agent's exact name>`;
   for Step 2, use `APEX-CALLER: 03-Architect`.
3. **Receive the compact summary** — the subagent writes the full JSON
   breakdown to `output_path` and returns a ≤15-line summary (or use the
   equivalent persisted result after the checks above)
   (`status`, `region`, `monthly_total`, `yearly_total`, `file_path`,
   `confidence`). **Do NOT paste subagent JSON inline** in your reply
   or your artifact prose.
   **Checkpoint** (MANDATORY): `apex/checkpoint` with `step: <step>`,
   `subStep: phase_<n>_pricing`.
4. **Read the JSON file** from `output_path` to populate your
   step-owned artifact(s). Copy figures **verbatim** — do NOT round,
   adjust, or "correct" them.
5. **Cross-check totals** — verify that the sum of
   `resources[].monthly_cost` equals `monthly_total`. Flag any
   discrepancy to the user before proceeding to the next phase.

## Step 2 Completion Gate

`apex/completeStep` and `apex/transition --complete` enforce a deterministic
arithmetic gate before newly completing Step 2. The gate reads
`agent-output/{project}/02-cost-estimate.json` only; it performs no price
lookups and does not call the pricing worker.

The estimate must satisfy all of these rules:

- `status` is `COMPLETE`; `FAILED`, `PARTIAL` and missing statuses block
  completion.
- `unresolved_items` is an empty array. Partial pricing is not accepted.
- `resources` is a non-empty array, and every line has a finite,
  non-negative numeric `monthly_cost`.
- The sum of `resources[].monthly_cost` equals `monthly_total` within
  `max(0.01, 0.5% of monthly_total)`. This allows penny-level currency
  rounding and minor tier-rounding drift, not material arithmetic errors.
- `yearly_total` is required and equals `12 * monthly_total` within
  `max(0.01, 0.5% of the expected yearly total)`.
- A resource line is blocked as unpriced when `sku`, `notes` or a
  price/rate field contains `UNPRICED`, `placeholder` or `TBD`.
- A resource line with `monthly_cost: 0` or `monthly_cost: null` needs an
  explicit non-empty `zero_cost_reason`. For backward-compatible auditability,
  notes that clearly state a legitimate zero-cost basis, such as free tier,
  included, no charge, zero-cost, `$0`, excluded or a documented removed charge,
  are also accepted.

New producer output SHOULD use `zero_cost_reason` for every zero-cost line.
Reviewer and parent prose may cite the field, but MUST NOT reinterpret it into
new pricing logic.

## Interrupted pricing recovery

A canceled terminal command or empty worker response is not proof of publication and is not a pricing failure category.
Inspect the exact output path, draft and referenced evidence before deciding whether more work is needed.
Preserve existing files, the original input contract and retry history; never launch another full estimate by default.
Recovery is permitted only within an existing retry allowance or explicit human authorization. If exhausted or the
worker is unavailable, stop with the saved paths and error rather than bypassing the worker or resetting the allowance.

When the canonical output exists, verify it and its source evidence read-only before reuse. When only a draft exists,
send the pricing worker the same pricing inputs plus `recovery: {draft_path, evidence_paths, remaining_requests,
prior_attempt}` and explicit authorization to publish that draft. Paths are concrete, not filename patterns.
An unowned draft or conflicting canonical output blocks mutation; request ownership/overwrite permission, never guess.

The worker must:

1. Resolve all paths from the supplied workspace root or absolute paths; do not rely on a shared terminal's cwd.
2. Parse the complete draft, verify original scope/SKUs/quantities, status, finite nonnegative line-item costs,
   empty unresolved items for COMPLETE, totals and annual arithmetic, and the applicable request budget.
3. Verify source freshness and input equivalence for every reused meter. For fallback evidence, check raw-response
   hashes, exact query and selected meter IDs/tiers, currency, timestamps, recorded MCP failure and calculation inputs.
   Missing provenance is not repaired by copying a FAILED subtotal or changing its status.
4. Preserve actual original collection counts in the draft. Historical evidence does not count as new network requests;
   the recovery summary separately states requests issued now. Carry forward remaining allowance for the interrupted
   attempt. Do not requery unless verification identifies missing evidence and the caller permits it within that budget.
5. Run validation successfully before publication. Recheck canonical-file existence and overwrite authorization;
   rename the validated draft noninteractively, verify the published file, then emit the required compact summary.
   A listed command is not a result. On cancellation, preserve the draft and report the interrupted stage;
   do not claim completion or silently launch a retry. An unavailable result remains unknown.

The parent then registers the actual successful cost JSON and evidence paths in the project index/handoff and supplies
them as `supporting_paths` to reviewers. No alias named `02-cost-estimate.json` is needed for a verified versioned output.
Only after current pricing evidence exists may artifact generation and independent reviews continue.

## MCP Tools the subagent uses on your behalf

| Tool | Purpose | Context |
| --- | --- | --- |
| `get_retail_prices` | Planned-resource retail prices | Primary |
| `query_costs` | Actual cost by Azure scope | Deployed only |
| `query_aks_costs` | Actual AKS cost breakdown | Deployed only |
| `forecast_costs` | Scope cost forecast | Optional, deployed only |
| `get_benefit_recommendations` | Reservation and savings-plan analysis | Optional |

The subagent deduplicates identical service, ARM SKU, region, meter, price-type,
and currency queries within its MCP call budget. Include explicit usage for
non-hourly meters. Canonical query and calculation rules live in
[`pricing-guidance.md`](pricing-guidance.md).

The subagent returns only `COMPLETE` or `FAILED`; it never returns `PARTIAL`.
Treat `FAILED` as a hard stop and surface `unresolved_items[]` to the user.
For mixed-source COMPLETE estimates, verify the referenced `retail_api_evidence[]`, selected meters, source labels,
timestamps and calculations alongside MCP evidence. Independent cost-feasibility review remains mandatory.

## No Parametric Fallback (HARD)

**No fallback to parametric knowledge or the Azure Pricing Calculator.**
If `cost-estimate-subagent` fails or is unavailable, STOP and notify
the user. Do NOT write dollar figures from memory. Do NOT proceed to
artifact generation without subagent-verified prices. Only that worker may use the constrained direct-API
evidence fallback; this does not authorize parent-side pricing or waive missing usage, review or approval gates.
