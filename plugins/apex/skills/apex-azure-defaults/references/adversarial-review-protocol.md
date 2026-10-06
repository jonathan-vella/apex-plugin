<!-- ref:adversarial-review-protocol-v3 -->

# Adversarial Review Protocol

Standard protocol for running adversarial reviews across all agents.
Gated reviews use `apex/reviewRequest`, built-in `rubber-duck`, and
`apex/recordReview`. Ungated reviews call `rubber-duck` directly with
the relevant checklist inline. Each agent specifies its own artifact,
artifact type, pass count and review focus; this reference defines the
shared mechanics.

## Review Lifecycle

Use this procedure in every producing agent, reviewer wrapper and completion consumer. Step-specific ownership,
required lenses, human gates and existing repair caps remain authoritative; this procedure grants no new permission.

1. Resolve current required evidence from the explicit owner selection and `apex/status` sections
  `session.review_selections` and `session.effective_reviews`. Without a selection, use the step's canonical path.
  Do not infer newest files or parse legacy audit prose into a selection. Unsupported replacement scopes return
  to their owner. Preserved superseded failures are history, not current blockers; missing deep lenses still block.
2. Verify primary and declared supporting inputs with `--verify-cache`, review identity/lens and unresolved findings.
  A current hash alone is not semantic approval. An accepted mitigation is not verified closure. Missing/stale
  evidence or unresolved current must-fix findings block advancement, regardless of historical step completion.
3. Before an authorized repair, compare the proposed change with approved resource types, SKUs, subnet placement,
  access modes and cost basis. Verify the reviewer's recommendation against provider or recorded proof evidence.
  Fix the finding without inventing topology. A proof establishes tested behavior, not authority to copy all its
  resources. Changed design or upstream ownership requires the named owner's approval, not automatic application.
4. Apply coherent owned repairs, run focused validation, finalize inputs, then re-review only affected reviews.
  Reuse unchanged valid evidence and unchanged user decisions. Do not rerun successful commands for nicer timing.
  Repeated ineffective repairs or exhausted caps stop with evidence; changing filenames/sessions resets no allowance.
5. Distinguish command retries from worker retries and repair iterations. Transient command failures follow the
  tool's declared cap; only permitted worker execution failures may retry. Missing/empty reviewer output permits
  one identical-input retry under the fallback below. A findings verdict is not an execution retry. Preserve attempt
  identity, inputs and actual outcome through `apex/reviewAudit`; new review authorization must be explicit.
6. Require the existing human gate for current inputs, then call the owner completion/transition command.
  Selection, approval, successful completion and permission for a later operation are separate facts. Preserve
  unchanged approval on bookkeeping recovery; index-stale writes need reindex, not repeated mutation. Update the
  mutable index/handoff after completion and validate them without editing reviewed inputs to change status.

## Lenses

Single source of truth for adversarial review lenses. Agents and the
`workflow-graph.json` MUST reference lens names from this table only;
new lenses are added here first and registered in
`tools/scripts/validate-workflow-graph.mjs` (`VALID_LENSES`) and the
`apex/reviewRequest` schema.

| Lens                        | Applies to (`artifact_type`)                                                         | Description                                                                            | Checklist anchor                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `comprehensive`             | requirements, architecture, cost-estimate, implementation-plan, iac-code, design-adr | Single-pass merged lens. Used by the **default flow** at every mandatory step.         | [Lens: comprehensive](adversarial-checklists.md#lens-comprehensive-single-pass-default)                 |
| `security-governance`       | architecture, implementation-plan, iac-code                                          | Policy compliance, identity, network isolation, encryption. Opt-in deep-review pass 1. | [Per-Category Checklists → Governance & Compliance](adversarial-checklists.md#governance--compliance)   |
| `architecture-reliability`  | architecture, implementation-plan, iac-code                                          | WAF balance, SLA feasibility, failure modes, dependencies. Opt-in deep-review pass 2.  | [Per-Category Checklists → Architecture & WAF](adversarial-checklists.md#architecture--waf)             |
| `cost-feasibility`          | architecture, cost-estimate, implementation-plan                                     | SKU sizing, pricing realism, RI / Savings-Plan math, budget alignment. Opt-in pass 3.  | [Cost-Estimate-Specific](adversarial-checklists.md#cost-estimate-specific-artifact_type--cost-estimate) |

## Default flow: 1-pass comprehensive

By default, every step that runs adversarial review runs **one
comprehensive pass**. No early-exit logic. No complexity-tier routing.

- Review kind = `canonical`
- `pass` = `1`
- `prior_findings` come from the review request metadata and captured transcript, not a parent-written prompt field.
- `apex/recordReview` writes one schema 1.1 sidecar JSON file
  (`challenge-findings-{artifact_type}.json` or the step-specific canonical path).
- Parent agent presents the per-finding decision panel (see
  `## Per-Finding Decision Protocol`) and then the aggregated proceed /
  revise gate.

### Reviewer unavailable rule (default + deep)

For gated reviews, request the prompt with `apex/reviewRequest`, call `rubber-duck`
with the returned prompt exactly as given, then import the captured transcript with
`apex/recordReview`. For ungated reviews, call `rubber-duck` with the artifact,
lens and matching checklist inline. If `rubber-duck` is unavailable, the capture
hook is inactive, `apex/recordReview` reports no captured transcript, permissions
or model eligibility block the call, or the delegation capability is missing,
**STOP** and request a human handoff to `10-Challenger`.

Include the verbatim error, artifact path/type, review lens, pass and expected
current evidence. Resume the parent only after current review evidence exists.
`10-Challenger` is a human-selected main agent with `disable-model-invocation: true`,
not a nested wrapper fallback. Do not invoke it as a subagent, widen caller allowlists,
enable nested delegation, switch models automatically, write findings files by hand,
or synthesize an inline gated review. Legacy discovery settings are not a security
boundary or evidence of runtime support.

For a successful call that produces missing or empty captured output, follow
[the diagnostic contract](workflow-gates.md#challenger-empty-output-diagnostic--bounded-retry):
log the failure, retry exactly once with identical inputs, then STOP and request a
human handoff after the second failure. Do not reset this budget by changing
wrappers or models.

If `10-Challenger` is already the active owner, request human intervention instead
of a self-handoff. Report the failure and missing evidence without restarting the
review. Preserve exhausted retry status across handoffs and resumed sessions;
human intervention does not itself satisfy the review gate or renew the retry allowance.

Tier annotations in `workflow-graph.json` (`opt_in_matrix`) are
**recommendations only** — they never auto-fire. The Orchestrator never
auto-triggers a multi-pass run based on `decisions.complexity`. The user
opts in explicitly (`decisions.review_depth = "deep"`, see "Project-scoped
opt-in" below) or via an ad-hoc handoff to `10-Challenger`.

### Mandatory floor

| Step | Default review                                                              | Skip condition                |
| ---- | --------------------------------------------------------------------------- | ----------------------------- |
| 1    | 1× `comprehensive`                                                          | —                             |
| 2    | 1× `comprehensive` + 1 cost audit (`cost-feasibility` lens on the estimate) | —                             |
| 3    | none (Step 3 is optional)                                                   | (skipped when Step 3 skipped) |
| 3.5  | none (Governance is discovery-only)                                        | always                        |
| 4    | 1× `comprehensive`                                                          | —                             |
| 5    | none (default-skip)                                                         | always                        |
| 6    | none (`## Policy precheck summary` folded into deployment artifact)         | always                        |
| 7    | none                                                                        | always                        |

> **Step 2 cost audit** is produced by the **existing**
> `cost-feasibility` lens through `apex/reviewRequest` and `rubber-duck` against the
> `02-cost-estimate.json` / `03-des-cost-estimate.md` artifacts.
> `cost-estimate-subagent` is **not** modified — it remains the
> cost-breakdown emitter consumed by 03-Architect.

### Project-scoped opt-in

01-Orchestrator captures `decisions.review_depth` once at boot via
`apex/decide` with `key: review_depth` and `value: default|deep`.
Every parent agent reads this on each invocation (survives resumed
sessions) and enters the opt-in deep-review path below when the value is
`deep`. Default value: `default`.

## Opt-in: Deep adversarial review

Multi-pass cascade rules (rotating lenses, recommended tier shape and per-pass
reviewer invocation) live in the sibling reference
[`adversarial-review-deep.md`](./adversarial-review-deep.md). Load that
file **only** when `decisions.review_depth == "deep"`, the user invokes
`10-Challenger` with multi-pass arguments, or the user picks the deep
option at a gate prompt (Steps 2 / 4 / 5b/5t).

## Severity Guardrails

Challengers MUST apply strict severity definitions:

| Severity     | Definition                                                                                                                                         | Examples                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `must_fix`   | **Deployment failure** (Policy Deny block, missing config, broken dependency) or **security breach** (public exposure, no auth, plaintext secrets) | Missing PE for locked-down KV, no MI user for AAD-only SQL       |
| `should_fix` | **WAF violation** or **operational risk** that won't block deploy but degrades production quality                                                  | Missing alerts, SPOF, incomplete diagnostics                     |
| `suggestion` | Nice-to-have, belongs in Step 7 (as-built), or "v2" item                                                                                           | Failover-region design, cert lifecycle, post-launch right-sizing |

> If a finding describes content that belongs in Step 7 (ops runbook, DR plan,
> documentation), classify as `suggestion`, not `should_fix`.

## Complexity Classification Criteria

`decisions.complexity` is a **deep-review shape hint only** (see
"Recommended tier shape" above). The Orchestrator does not use it to
auto-trigger reviews. The Requirements agent classifies; if missing from
old sessions, default to `"standard"`.

| Tier         | Criteria                                                                             |
| ------------ | ------------------------------------------------------------------------------------ |
| **Simple**   | ≤3 resource types, single region, no custom Azure Policy, single environment         |
| **Standard** | 4–8 resource types, multi-region OR multi-env (not both extreme), ≤3 custom policies |
| **Complex**  | >8 resource types, multi-region + multi-env, >3 custom policies, hub-spoke topology  |

## Reviewer Routing

Each review lens is executed by the built-in `rubber-duck` agent through
`apex/reviewRequest` and `apex/recordReview`. All lenses share the same reviewer
contract; the review request rotates the lens per pass. The selected session
model is controlled by the client, not by APEX review metadata.

## Parallel Invocation (Cross-Artifact Reviews)

When a step reviews **multiple independent artifacts**, run their first passes
in parallel through the available delegation capability. Two reviews are independent
when they target different artifacts and both are first-pass requests.

| Step               | Parallel Pair                              | Why Safe                                                     |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| Step 2 (Architect) | Architecture pass 1 ‖ Cost Estimate review | Different artifacts, both first-pass requests                |
| Step 5 (CodeGen)   | Combined validation worker (sequential) | One worker runs lint then review; not a parallel pair |

**Rules**:

1. Both calls MUST be first-pass requests with no inter-dependency
2. Await both results before proceeding to conditional pass 2
3. If either returns a blocking failure, halt before subsequent passes
4. For Step 4: if governance review returns `must_fix` items that affect
   the plan, include compact governance findings in the pass 2 handoff
   context alongside plan pass 1's compact string

> **Do NOT parallelize** rotating-lens passes (1→2→3) within the same
> artifact — each pass depends on current evidence from the previous pass.

## Context Efficiency — Compact Prior Evidence

> [!IMPORTANT]
> After `apex/recordReview` writes each pass result to disk, **do NOT keep the full JSON
> in working context**. Extract only the compact summary needed by the parent
> and discard the rest.
>
> For passes 2 and 3, rely on the `apex/reviewRequest` deep-pass request and
> include only compact previous-pass context in any user-visible handoff — **not
> full JSON objects**:
>
> ```text
> compact_prior_evidence: "Pass 1: <compact summary>\nPass 2: <compact summary>"
> ```
>
> This prevents each reviewer call from re-injecting thousands of
> tokens of prior findings into the parent context. Full detail is
> already saved to disk.

## Context Shredding for Challenger Inputs

When passing predecessor artifacts to the challenger, apply context shredding
(from the `apex-context-management` skill, Mode A: Runtime Compression) based on current context usage:

- **< 60% context**: Pass full artifact
- **60–80% context**: Pass only key H2 sections (resource list, SKU decisions,
  WAF scores, compliance requirements, budget). Drop detailed prose.
- **> 80% context**: Pass only the decision summary from `apex/status`
  `decisions` field plus `decision_log` entries plus the resource list.
  The `decision_log` provides rationale for prior choices without loading full artifacts.

This reduces challenger input by 40–70% and cuts turn latency proportionally.

## Approval Gate Summary Template

After all passes, present a merged summary:

```text
⚠️ Adversarial Review Summary ({N} passes)
  must_fix: {total} | should_fix: {total} | suggestions: {total}
  Key concerns: {top 2-3 must_fix titles across all passes}
  Findings:
    - agent-output/{project}/challenge-findings-{type}.json (single-pass) or
    - agent-output/{project}/challenge-findings-{type}-pass1.json … (deep-review)
```

For per-finding decisions before the summary, follow `## Per-Finding Decision Protocol`.

## Findings Table Rendering Format

Every agent that presents challenger findings in chat MUST print a
**multi-line markdown table** — never a single-line string with escaped
`\n` characters. Leave blank lines before and after the table so
markdown renderers parse it correctly.

Canonical layout:

```markdown
**Challenger Findings**

| ID | Severity | Title | WAF Pillar | Recommendation |
| --- | --- | --- | --- | --- |
| {id} | {severity} | {title} | {waf_pillar} | {recommendation} |

**Totals:** N must-fix, N should-fix, N suggestions.
Machine-readable detail is in `challenge-findings-{type}.json`.
```

- Order rows: all `must_fix` first, then `should_fix`, then `suggestion`.
- `{id}` = first 8 hex chars of the stable issue hash (section 2b).
- Column values map directly to the JSON `findings[]` fields.

## Findings Cache (REVISE-loop optimization)

### Review input finalization

Before taking review metadata, finish all content edits, rendering, permitted formatting and validation.
Wait for pending writers to finish; then dispatch reviewers against those final saved bytes. While any review
is running, the parent must not edit its target or shared evidence. Parallel independent reviews are allowed
only when their complete input sets remain unchanged. This is a workflow discipline, not an operating-system lock.

For Step 2, keep mutable approval/review status in recall, decision sidecars, the project index and handoff.
The assessment and cost document use a stable pointer to those records, not a badge or checkbox that must change
after review. Do not mark a document approved before the human gate, or rewrite it afterward merely to reflect approval.
If substantive findings require changes, batch the authorized edits and validation before re-reviewing affected inputs.
An accepted risk is a recorded disposition, not proof of remediation; do not suppress unresolved findings.

Verify current review hashes immediately before completion and again when the next owner resumes. A completed
state step is not proof of current artifact bytes. On drift, stop the affected handoff and return to the artifact owner
with the mismatch; preserve prior approvals and evidence. Compare the actual changes without assuming formatting.
Even formatting-only changes invalidate exact-byte evidence: never normalize hashes or restamp an old review.
Do not edit upstream artifacts or invalidate unrelated project decisions as part of drift recovery.

`apex/reviewRequest` computes the review request metadata and signs the
request/metadata with an HMAC. The signature is tamper evidence for the local
workflow; it is not a security boundary and does not grant approval. The prompt
returned by `apex/reviewRequest` carries the `APEX-REVIEW:` header that the hook
uses to capture the `rubber-duck` answer.

`apex/recordReview` imports findings from the transcript's JSON block, computes
the sidecar metadata, hashes the challenged inputs, and writes schema 1.1
`challenge-findings-*.json` sidecars. Agents never compute cache inputs, restamp
old sidecars, or write findings files by hand. If `apex/recordReview` returns a
stale-artifact or metadata mismatch, request a new review instead of refreshing
old hashes.

Directory artifacts retain the byte-hash contract owned by the server: UTF-8 JSON
of sorted `[relative/posix/path, file_sha256]` pairs, walking each directory in
lexical order. Exclude `.git`, `.terraform`, `node_modules`, `.venv` and
`__pycache__`; reject symlinks, special files and empty trees. All remaining
files count.

Legacy schema 1.0 sidecars created by `challenger-review-subagent` remain valid
while the old worker is installed and the validator recognizes them. New reviews
and replacement passes must use the `apex/reviewRequest` → `rubber-duck` →
`apex/recordReview` path and schema 1.1 sidecars.

> **Decisions sidecars are never cached.** Cache only applies to the
> findings JSON. The `challenge-findings-{type}-decisions.json` sidecar
> is owned by the parent agent and is updated on REVISE.

## Per-Finding Decision Protocol

Replaces the legacy single-binary "Approve / Revise" gate with a per-finding
interactive flow. After all challenger passes for an artifact complete, the
parent agent presents one batched `askQuestions` call where each in-scope
finding (`must_fix` + `should_fix`) is its own question with four action
options. Decisions are persisted in a sidecar JSON file and via
`apex/finding`. A final aggregated proceed/revise gate follows.

### 2a. Sidecar file location

Decisions are written to:

```text
agent-output/{project}/challenge-findings-{artifact-type}-decisions.json
```

The reviewer **never reads or writes this file** — it is owned
by the parent agent. Schema:

```json
{
  "challenged_artifact": "agent-output/{project}/{artifact}.md",
  "artifact_type": "requirements|architecture|cost-estimate|governance|plan",
  "decisions": [
    {
      "issue_id": "<8-char hash>",
      "source_file": "challenge-findings-{type}-pass{N}.json",
      "pass_number": 1,
      "issue_index": 3,
      "severity": "must_fix",
      "title": "...",
      "action": "accept|reject|defer",
      "note": "free text or empty string",
      "decided_at": "<ISO-8601>"
    }
  ]
}
```

**Atomic write**: write to `{path}.tmp`, then `os.rename` over the target.
**Append on Revise re-runs**: never overwrite. Existing entries with a
matching `issue_id` are kept. Reuse the decision only while the finding and mitigation are unchanged;
a prior acceptance is not evidence of resolution. Changed guidance requires a new explicit decision.

### 2b. Stable issue identity

Normalize canonical findings for presentation: `title = claim`, `description = evidence`,
`failure_scenario = impact`, and `suggested_mitigation = suggested_fix.proposed_edit` when supplied.
These are local presentation aliases, not new fields in persisted findings. Legacy findings may use their original names.
Use the normalized title for identity and sidecar title; do not require nonexistent WAF or recommendation fields.

```text
issue_id = sha256(category + "|" + title + "|" + artifact_section).hexdigest()[0:8]
```

Use the persisted canonical finding `id` as `issue_id` after current verification;
for legacy payloads compute via `--finding-ids` using canonical presentation fields.
Computed deterministically at panel-build time. The challenger
reviewer's JSON schema is **not** modified — `issue_id` is a parent-side
derivation. Re-running against the same finding produces the same hash,
which makes Resume / Revise idempotent.

### 2c. Auto-load existing decisions on Resume / Revise

Before building the panel:

1. If `challenge-findings-{type}-decisions.json` exists, read it.
2. Compute `issue_id` for every finding in the merged source set (2e).
3. Reuse an existing decision only for an unchanged issue and mitigation. Verify closure independently;
  unresolved blockers remain blocking even when previously accepted, rejected or deferred.

If the sidecar is absent, treat as "no prior decisions" — legacy
artifacts that pre-date this protocol work unchanged.

### 2d. Unattended mode

If the environment variable `APEX_UNATTENDED=1` is set, the protocol
**bypasses `askQuestions` entirely**:

- All `must_fix` → `action: "defer"`,
  `note: "auto-deferred (unattended)"`.
- All `should_fix` → `action: "defer"`, same note.
- All `suggestion` → unchanged (auto-deferred as in attended mode).
- If any unresolved `must_fix` remains, **STOP** before step completion or forward handoff.
  Persist deferred decisions and list the blocking findings. A deferred or previously accepted
  decision is not proof of remediation; require current review evidence confirming resolution.
- This rule applies to every production run; no test or unattended setting can waive blockers.
- With no unresolved `must_fix`, continue only under existing, explicit unattended approval scope.
  Never infer production approval from `APEX_UNATTENDED=1` alone.

### 2e. Multi-source merge order

When an agent has multiple `challenge-findings-*.json` sources (Architect
merges cost-estimate + arch pass 1/2/3; Planner merges arch pass 1/2/3),
build one batched panel using this order:

1. All `must_fix` first, sorted by `(source-order, original-index)`.
2. All `should_fix` next, same sort.

Source order for Architect:
`cost-estimate → architecture pass 1 → pass 2 → pass 3`.
Source order for Planner: `pass 1 → pass 2 → pass 3`.

Across lenses of unchanged artifacts, compact prior evidence avoids duplicate reports.
Across artifact revisions, the reviewer must verify prior findings and retain unresolved issues.
Do not remove a blocker from the merged set just because it appeared before.

### 2f. Soft cap on panel size

Default cap: **12 questions**. If `must_fix + should_fix > 12`:

1. Render the full summary table in chat (unchanged).
2. Build the panel from the top 12 by severity (must_fix first, sorted
   per 2e).
3. Auto-defer the rest with
   `note: "auto-deferred (panel cap; re-run gate after revising must_fix)"`.
4. Emit a chat warning:
   `Panel capped at 12 of {N} findings; {M} auto-deferred.`

The cap is a constant. Agents do not override it.

### 2g. `askQuestions` payload shape

Per finding:

| Field                | Value                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `header`             | `{artifact-type}-pass{N}-{idx}` (≤50 chars). Examples: `architecture-pass1-3`, `cost-estimate-pass1-0`. **Hard rule** — must be unique across the merged batched call. |
| `question`           | `title` (≤200 chars; truncate with `…`).                                                                                                                               |
| `message`            | Markdown block with severity badge + `category` + `description` + `failure_scenario` + `artifact_section` + `suggested_mitigation`.                                    |
| `options`            | Four fixed labels (in this order): `Accept (apply mitigation)`, `Reject (accept risk)`, `Defer (carry to handoff)`, `Edit (custom guidance)`.                          |
| `recommended`        | `Accept` for `must_fix`; `Defer` for `should_fix`.                                                                                                                     |
| `allowFreeformInput` | `true` (enables Edit + per-finding notes).                                                                                                                             |

### 2h. Edit / freeText / skipped semantics

Deterministic — no agent-level interpretation:

| User input                                                          | Resulting `action` | Resulting `note`                                    |
| ------------------------------------------------------------------- | ------------------ | --------------------------------------------------- |
| `Edit` selected + non-empty `freeText`                              | `accept`           | `Edit: <freeText>` (custom replacement guidance) |
| `Edit` selected + empty `freeText`                                  | `defer`            | `"Edit selected without guidance — auto-deferred."` |
| `Accept` / `Reject` / `Defer` selected (with or without `freeText`) | matches selection  | `<freeText>` if present, else empty string |
| `skipped: true`                                                     | `defer`            | `"User skipped — auto-deferred."`                   |

### 2i. Persist decisions (sidecar + apex/finding)

The current sidecar schema has no `edit` action and requires string notes.
Keep the Edit UI choice, persist it as `accept` with the `Edit:` note prefix followed by a space,
and apply that custom guidance
instead of the suggested mitigation. Do not add schema fields or emit null notes.

For each answered question:

1. Append a `decisions[]` entry to the sidecar JSON (atomic write per 2a).
2. Call `apex/finding` with
   `add: "{severity}|{action}|{issue_id}|{title}|{note}"`.

   Pipe-delimited single-line format (Sg2). Consumers split on `|` with
   **max 4 splits** so titles or notes that contain `|` remain intact.
  Use an empty final field when the note is empty.

### 2j. No-op gate clarification

For Requirements revisions, `Accept (apply mitigation)` authorizes the stated edit to owned artifacts.
Apply compatible accepted fixes as a batch and validate before independent re-review; ask only about
conflicts or expanded scope. Supply prior compact findings, dispositions and changed sections as context,
not proof of closure. Keep the final human gate separate from mitigation authorization.
If the accepted mitigation leaves the same blocker unresolved, checkpoint and request human direction;
do not repeat an unchanged edit/review loop or infer approval. Technical reviewer failures retain the
existing identical-input retry limit; revisions do not reset that allowance.

If `must_fix + should_fix == 0`:

- **Skip the per-finding panel only.**
- Agents still render their summary blocks (WAF scores, governance
  summary, plan summary, etc.).
- The final aggregated gate becomes a trivial Proceed confirmation.

### 2k. Revise behavior matrix

| Agent           | On user `Revise` final-gate choice                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 02-Requirements | Apply Accepted fixes → re-run challenger (`overwrite: true`) → re-build panel (skipping issues with prior decisions per 2c) → re-present gate. |
| 03-Architect    | Same as Requirements; re-run all relevant passes per the configured pass count.                                                                |
| 04g-Governance  | Apply Accepted fixes → **DO NOT re-run challenger** (cap = 1 pass) → re-present final aggregated gate only with the existing decision sidecar. |
| 05-IaC Planner  | Same as Requirements.                                                                                                                          |

### 2l. Final aggregated gate

After the per-finding panel completes (or is skipped per 2j / 2d):

1. Render a decisions table in chat:

   ```text
   ID       Severity    Title                                  Action   Note
   a1b2c3d4 must_fix    Missing private endpoint on storage    accept   Adopt PE in Phase 2
   e5f6g7h8 should_fix  Cosmos DB region pair                  defer    —
   ```

2. Present a single `askQuestions` with options:
   - `Revise (apply Accepted findings)` —
     `recommended: true` if any `must_fix` had `action == "accept"`;
     otherwise not recommended.
   - `Proceed (handoff next step)` — recommended otherwise.
   - **Governance only**: also `Refresh governance` (preserved from the
     existing 04g Phase 3 gate).

### 2m. Payload example

Two-finding panel for an Architect gate. Source files merged per 2e
(`challenge-findings-cost-estimate.json` first, then
`challenge-findings-architecture-pass1.json`).

```json
{
  "questions": [
    {
      "header": "cost-estimate-pass1-0",
      "question": "Cosmos DB autoscale max RU/s exceeds budget by 38%",
      "message": "**must_fix** · cost-feasibility\n\n**Description**: Configured 4000 RU/s autoscale max but plan caps at 2900.\n\n**Failure scenario**: Burst traffic triggers autoscale to ceiling, monthly bill overruns committed budget.\n\n**Artifact section**: §4 Cost — Cosmos DB row.\n\n**Suggested mitigation**: Lower max_throughput to 2900 or split workload across two containers.",
      "options": [
        { "label": "Accept (apply mitigation)", "recommended": true },
        { "label": "Reject (accept risk)" },
        { "label": "Defer (carry to handoff)" },
        { "label": "Edit (custom guidance)" }
      ],
      "allowFreeformInput": true
    },
    {
      "header": "architecture-pass1-2",
      "question": "Storage account allows public blob access",
      "message": "**must_fix** · security-governance\n\n**Description**: …",
      "options": [
        { "label": "Accept (apply mitigation)", "recommended": true },
        { "label": "Reject (accept risk)" },
        { "label": "Defer (carry to handoff)" },
        { "label": "Edit (custom guidance)" }
      ],
      "allowFreeformInput": true
    }
  ]
}
```

Resulting sidecar entry for the first answered question (user picked
`Accept` with note "Lower to 2500"):

```json
{
  "issue_id": "a1b2c3d4",
  "source_file": "challenge-findings-cost-estimate.json",
  "pass_number": 1,
  "issue_index": 0,
  "severity": "must_fix",
  "title": "Cosmos DB autoscale max RU/s exceeds budget by 38%",
  "action": "accept",
  "note": "Lower to 2500",
  "decided_at": "2026-05-09T14:32:11Z"
}
```

Corresponding `apex/finding` call:

```text
add: "must_fix|accept|a1b2c3d4|Cosmos DB autoscale max RU/s exceeds budget by 38%|Lower to 2500"
```
