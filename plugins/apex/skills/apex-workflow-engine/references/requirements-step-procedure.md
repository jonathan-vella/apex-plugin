<!-- ref:requirements-step-procedure-v1 -->

# Requirements Step Procedure

Detailed Step 1 procedure moved from the Requirements agent. The agent body keeps
the role, stop rules, gate, and output contract; load this reference when executing
Step 1 discovery, artifact generation, review, or Gate 1.

## SKU Manifest - User Pins (Mandatory Elicitation)

Step 1 creates `agent-output/{project}/sku-manifest.json` and renders `sku-manifest.md`.

- **Always cover Phase 3j (SKU and sizing preferences elicitation)** for every project.
  Explicit supplied preferences count; ask for missing classes, never assume "no preference". See
  [`service-class-menu.md` § 3j](../skills/apex-azure-defaults/references/service-class-menu.md#3j-sku-and-sizing-preferences-mandatory-for-every-project).
- Capture hard preferences the user volunteers: pinned SKUs/sizes, tier floors driven by
  compliance or existing commitments, reserved-instance purchases, and per-environment
  overrides.
- Do not exhaustively enumerate SKUs. Only what the user actually has a preference about.
- An empty `services[]` is valid only when the user explicitly answered "no preference" for
  every applicable class. It is **not** the default — it must be the recorded outcome of
  Phase 3j.
- Every service entry written at Step 1 uses `source: "user-pin"`, `source_step: "1"`, and
  `last_modified_rev: 1`.
- After writing rev 1, set `decisions.sku_manifest_status = "draft"`,
  `decisions.sku_manifest_revision = 1`, and `decisions.sku_preferences_captured = true`
  with `apex/decide`.
- Render `sku-manifest.md` with `tools/scripts/render-sku-manifest-md.mjs`; do not hand-edit it.

## Phase 1: Business Discovery

Batch independent questions as the P0 directive in `02-requirements.agent.md` requires.

Ask in Round 1:

- Project name, freeform.
- Industry, with six common options plus freeform.
- Company size: Startup, Mid-Market, Enterprise.
- System type or project description, with common workload options plus freeform.

Ask in Round 1b:

- Scenario: greenfield, migration, modernization, or extension.
- Target environments with `multiSelect: true`; default Dev + Production unless the prompt says otherwise.
- Brief workload description in one or two sentences.

If migration or modernization is selected, ask in Round 2:

- Current platform.
- Pain points with `multiSelect: true`.
- Parts to preserve with `multiSelect: true`.

When the initial prompt provides explicit answers, capture them without asking again.
Question options are either absent (pure freeform) or two or more; one option with freeform is invalid.

## Phase 2: Workload Pattern Detection

Infer the workload pattern from the business signals, then ask the user to confirm it rather than
asking them to classify from scratch.

Ask for:

- Workload pattern confirmation with the inferred pattern recommended and four or five alternatives.
- Daily users.
- Monthly budget with options plus freeform.
- Data sensitivity with `multiSelect: true`.
- Concurrent users for web/API patterns.
- Transactions per second for database-heavy, analytics, event-driven, or IoT patterns.
- Workload profile with `ask_user`; never infer it from project or environment names such as `dev`:
  `alz-backed` — the landing zone supplies subscription, networking, identity, monitoring and policy;
  `standalone` — lab or demo in one subscription, APEX also designs supporting networking, identity and monitoring.
- IaC tool preference, defaulting to Bicep unless the handoff supplied a value.
- **Cost alert recipients (`cost_alert_emails`)** — freeform multi-email list, pre-filled with
  `[<git config user.email>]`. They receive cost-anomaly notifications and, when the Action Group
  is created new, become its email receivers. Routing prose belongs to 03-Architect.
- **`cost_monitoring_mode`** — ask **only when** environments include `dev` or `sandbox` and
  exclude `prod`/`staging`: `enforced` (recommended; budget+AG+anomaly), `minimal` (budget only),
  or `deferred` (none). For `deferred`, also require freeform
  `cost_monitoring_exception.rationale` and `cost_monitoring_exception.expiry_date` (YYYY-MM-DD).
  Prod/staging always use `enforced`; do not prompt.

After the workload profile and IaC answers, record them:

Record with `apex/decide` with `key: workload_profile` and `value: <alz-backed|standalone>`.

Record with `apex/decide` using `key: iac_tool` and `value: <Bicep|Terraform>`.

Record the cost-monitoring answers:

Record with `apex/decide`:

- `key: cost_alert_emails`, `value: <json-array>`
- when prompted (non-prod), `key: cost_monitoring_mode`, `value: <enforced|minimal|deferred>`
- when mode is deferred, `key: cost_monitoring_exception`,
  `value: {"rationale":"<text>","expiry_date":"YYYY-MM-DD"}`

## Phase 3: Service Recommendations

This phase is required. Read once, then follow the batched question
runbook in
[`apex-azure-defaults/references/service-class-menu.md`](../skills/apex-azure-defaults/references/service-class-menu.md)
(Batches A → B → C → 3i confirm → **3j SKU/sizing preferences (mandatory)**).
Externalised to keep per-turn system-prompt replay small; the full per-class
question set, options, and batching rules live in that reference. Step 3j
must be covered for every project; supplied preferences count, unanswered classes require questions.

After the `relational_db` answer comes back, record it:

Record with `apex/decide` using `key: relational_db` and `value: <choice>`.

After Step 3j completes, record the mandatory elicitation flag:

Record with `apex/decide` using `key: sku_preferences_captured` and `value: true`.

## Phase 4: Security and Compliance

This phase is required. Capture compliance, authentication, region and the application boundary;
ask only for missing or conflicting answers. The canonical security baseline is mandatory, not an opt-out menu.
Distinguish public-facing web applications from APIs and identify private-client access needs.
Do not offer "private networking only when policy requires". DNS ownership remains pending governance verification.

Ask for:

- Compliance frameworks with `multiSelect: true`.
- Additional security measures beyond the baseline with `multiSelect: true`, only when relevant.
- Authentication method.
- Region, defaulting to `swedencentral` unless service availability requires an exception.

Apply GDPR and data residency guardrails when relevant:

- Flag global services such as Front Door, Entra External ID, Traffic Manager, and Azure DNS for
  EU Data Boundary validation.
- Prefer ZRS over GRS when single-region data residency is required.
- Do not recommend Azure AD B2C for greenfield projects; use Entra External ID.

## Phase 5: Draft and Confirm

Only enter this phase after Phases 1-4 have each collected answers.

Read these references once, after questioning:

1. `.github/skills/apex-azure-defaults/SKILL.md`
2. `.github/skills/apex-azure-artifacts/SKILL.md`
3. `.github/skills/apex-azure-artifacts/templates/01-requirements.template.md`
4. `.github/skills/apex-azure-artifacts/templates/PROJECT-README.template.md`
5. `.github/instructions/sku-manifest.instructions.md`

Then:

Reconcile the selected scope before writing and after accepted fixes: deployable host/image,
workload identity and grants, app/auth scope, monitoring endpoint, private access/DNS and SKU/budget constraints.
When removing an application, remove or explicitly defer its dependent runtime assumptions together.
Ask once for any resulting scope decision; do not invent images, credentials or user approval.

1. Generate `agent-output/{project}/01-requirements.md` with the exact H2 structure from the
   template, including business context, workload pattern, NFRs, compliance, budget, region,
   workload profile, service recommendations, and `iac_tool`.
2. Generate `agent-output/{project}/README.md` from the project README template with Step 1 in progress
   and later steps pending.
3. Generate `agent-output/{project}/sku-manifest.json` rev 1 with user pins only.
4. Render `agent-output/{project}/sku-manifest.md` from the JSON.
5. Run applicable non-Markdown shape checks. Artifact Markdown validation belongs to lefthook
  `artifact-validation` and Challenger; do not invoke it directly.
6. Record mandatory decisions: `iac_tool`, region, `workload_profile`, SKU manifest status, and SKU manifest revision.
7. Checkpoint `phase_5_artifact`.
8. **After steps 1-7 pass, chain into Phase 6a in the same turn.** The next tool
  call after the successful `apex/checkpoint` for `phase_5_artifact` is
  `apex/reviewRequest` for the Step 1 gated review, followed by the worker tool
  targeting `rubber-duck` with the returned prompt exactly as given. Do not emit any
  user-facing summary, "ready for review"
   note, or final assistant message between Phase 5 and Phase 6a.

## Auto-Trigger Blocker (between Phase 5 and Phase 6)

This block is a hard stop rule, not a recap.

- Review readiness requires requirements, README, manifest JSON, rendered manifest
  Markdown, successful shape checks, decisions and `phase_5_artifact` checkpoint,
  in that order. A requirements write alone is not review readiness. Finish those
  prerequisites first; failed rendering/checks block review until repaired.
- You MAY NOT end the turn, hand off, render a final summary, or call
  `apex/completeStep` until `challenge-findings-requirements.json`
  exists and is current (`apex/completeStep` refuses when the review gate is blocked; do not work around it).
- Announcing the review is not invoking it; the very next review tool call is `apex/reviewRequest`,
  immediately followed by the worker call with the returned prompt.
- An incomplete/failed prerequisite also blocks Phase 6. A runtime subagent error follows the
  Phase 6a fallback (human handoff to `10-Challenger`, then stop). Missing required
  tools or tool eligibility likewise blocks; do not attempt an inline review.

## Phase 6: Challenger Review and Per-Finding Decision Panel

This phase is required before Gate 1. Do not collapse it into a single proceed/revise prompt.

### 6a. Invoke the gated review

Call `apex/reviewRequest` with `step: "1"` and `project`. It returns a `nonce`
and an exact `prompt`.

Delegate to `rubber-duck` with the returned `prompt` exactly as given. Do not edit,
wrap, summarize, or add fields; the first line is the `APEX-REVIEW:` header used by
the capture hook. Built-in `rubber-duck` does not require an `agents:` frontmatter entry.

After the reviewer returns, call `apex/recordReview` with the `nonce`.
`apex/recordReview` imports findings from the captured transcript JSON block and
writes `agent-output/{project}/challenge-findings-requirements.json`.
If it reports several answers, pass the selected `transcript`; to replace an
earlier review after revisions, request a new review and pass `expectedSha`.

After `apex/recordReview` succeeds, checkpoint `phase_6_challenger`.

**Reviewer unavailable rule (mandatory)**: if `rubber-duck` is unavailable, the
capture hook is inactive, `apex/recordReview` reports no captured transcript, or a
worker resolution error occurs, surface the verbatim error and present the existing
`10-Challenger` handoff, then stop for the user to select it. `send: true` does not
authorize automatic invocation. No inline review, fabricated findings or automatic
automatic fallback is allowed. Resume only with current review evidence; a returned
handoff is not proof of success or human approval.

### 6b. Render findings table

Print a multi-line Markdown table, one finding per row, with blank lines around it (never one line
or escaped `\n`):

```markdown
**Challenger Findings**

| ID | Severity | Title | WAF Pillar | Recommendation |
| --- | --- | --- | --- | --- |
| 0f47a77c | must_fix | Example title | Security | Example recommendation |
| 5c077877 | should_fix | Another title | Cost Optimization | Another recommendation |

**Totals:** 1 must-fix, 1 should-fix, 0 suggestions.
Machine-readable detail is in `challenge-findings-requirements.json`.
```

Render canonical `findings[]` fields: `id` as ID, `severity`, `claim` as Title,
and `suggested_fix.proposed_edit` as Recommendation. Derive WAF display only from
the protocol mapping or show "Not supplied"; do not invent legacy JSON fields.

### 6c. Per-finding decision panel

Follow `## Per-Finding Decision Protocol` in
[`adversarial-review-protocol.md`](../skills/apex-azure-defaults/references/adversarial-review-protocol.md)
for question shape, option labels, deterministic action mapping,
batched question rules, and the 12-question cap. Requirements-step
specifics:

- `header` namespace: `requirements-pass1-{idx}` (unique, ≤50 chars).
- `recommended`: `Accept` for `must_fix`; `Defer` for `should_fix`.
- Skip the panel when `must_fix + should_fix == 0`.
- Suggestions auto-defer and never appear in the panel.

### 6d. Persist decisions

For each answer:

- `issue_id` follows the protocol's canonical finding identity, using `claim`
  for the legacy display title; preserve the persisted finding `id`.
- Append a `decisions[]` entry to
  `agent-output/{project}/challenge-findings-requirements-decisions.json`
  via atomic write.
- Run
  `apex/finding` with `add: "{severity}|{action}|{issue_id}|{title}|{note}"`.
- Map user input to action + note per the protocol's deterministic table.

### 6e. Apply accepted fixes and final gate

`Accept (apply mitigation)` authorizes the stated mitigation, not step completion.
Apply compatible accepted fixes together to owned Step 1 artifacts; reconcile dependent sections and validate.
Clarify only conflicting/custom guidance or changes beyond accepted scope. Do not ask again whether to apply it.
Re-review changed requirements with `overwrite: true`, prior compact findings/dispositions and changed sections.
Require explicit resolution checks and a comprehensive regression review; prior decisions never suppress blockers.
Present new or changed findings; do not silently reapply an ineffective accepted fix.
If the same blocker persists after its accepted mitigation, checkpoint and request human direction with the
failed resolution evidence instead of repeating an unchanged edit/review loop. No forced approval or new retry allowance.

Once accepted changes have current review evidence and no unresolved `must_fix` remains, present Gate 1:
`Proceed` (Architecture handoff) or `Revise` (collect the requested change, apply, validate and re-review).

On `Proceed`, require current review, resolved blockers and human approval, call
`apex/completeStep` with `step: "1"`, mark README complete and hand off to
Governance Discovery.

If `APEX_UNATTENDED=1` is set, skip the question tool per the protocol's unattended-mode rules and
persist deferred decisions. Stop before completion or handoff while any unresolved `must_fix` remains.

