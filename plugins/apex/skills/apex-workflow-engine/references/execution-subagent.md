<!-- ref:execution-subagent-v1 -->
# Execution Subagent Contract

This is a reference-only parent-to-worker contract, not an executable slash
entrypoint. Copy the ordered Inputs, Activities, Outputs sections into the
invocation of a named, explicitly allowlisted worker. The worker's own agent
definition selects its model and tools; this reference grants no permissions.
Do not invoke an unnamed default worker or infer model eligibility from a label.
Unavailable named workers or unsupported transitions require a return to the
parent, not an automatic fallback, context fork, or nested delegation.

## Inputs

State the parent's objective in at most four sentences. Name the project,
artifact or deployment target, required source paths or current compressed
digests, schema/hash/freshness evidence, allowed writes, and observable success
criterion. Include required parameters and approval evidence for consequential
operations. A digest cannot replace mandatory live governance or schema checks.

Example: invoke `iac-preview-subagent` with
`template_path: infra/bicep/my-project/main.bicep`,
`parameters_path: infra/bicep/my-project/main.bicepparam`, and
`resource_group: rg-my-project-dev`. Success: return the exact
`WHAT-IF ANALYSIS RESULT` text block from its Output Contract, with
`Status: [PASS|FAIL|WARNING]`, change counts, policy details, resource changes,
cost impact (or `unavailable`), and recommendation. No findings file is written.
Preview evidence is not deployment approval.

## Activities

List the exact ordered commands or permitted tools with workspace-relative or
absolute paths, environment prerequisites, and output destinations. Use bounded
output capture. Artifact edits use file-editing tools, never shell redirection.
Do not widen the recipient's tool permissions through the invocation text.

Workers execute only the assigned slice. They do not ask the user questions,
manage parent todos, dispatch subagents, or edit upstream inputs. Missing or
stale inputs require a targeted permitted read or return to the parent.
If the required tool, model, approval, or input is unavailable, stop and return
the named worker's failure shape with the missing evidence; do not replace its
enum with a generic BLOCKED verdict. The parent owns recovery and user questions.

## Outputs

Choose the output mode required by the named worker, not a universal disk format:

- **File JSON**: specify the authorized on-disk path and the worker's schema or
	documented JSON shape, plus its compact parent summary. The parent reads the
	persisted payload when schema evidence is required; chat prose is not a substitute.
- **Fixed verdict**: use the worker's exact enum within its declared response shape.
- **Text summary**: return the worker's exact text block, field order and bounds;
	no findings-file write is implied. A verdict can be part of this text summary.

The named worker's agent definition and its explicitly delegated I/O reference
are the source authority for output mode, schema, verdict, failure shape and allowed
writes. Read the linked source before invocation; this reference and Local adapters
cannot override it. Do not convert a text-only worker to file JSON or a file-output
worker to an inline-only response. Scratch files and saved plans are not findings JSON.
The parent persists returned evidence only if its own contract explicitly owns that
artifact and authorizes the write; this reference grants no parent persistence duty
or permission. Preserve provenance and verify the required evidence before advancing.

### iac-validate-subagent

Source: [agent Output Contract and Scope](../../../agents/_subagents/iac-validate-subagent.agent.md).
Text summary: `BICEP VALIDATION RESULT`, lint `PASS|FAIL`, and
`TERRAFORM VALIDATION RESULT`, lint `PASS|FAIL`, and
`Verdict: {APPROVED|NEEDS_REVISION|FAILED}`. No findings-file writes; compiled ARM,
compiler cache, isolated `TF_DATA_DIR` and provider cache are permitted scratch
only. Do not invent a `validate_gate` block.

### iac-preview-subagent

Source: [agent Output Contract and Scope](../../../agents/_subagents/iac-preview-subagent.agent.md).
Text summary: `WHAT-IF ANALYSIS RESULT`, `Status: [PASS|FAIL|WARNING]`.
Text summary: `TERRAFORM PLAN RESULT`, `Status: [PASS|WARNING|FAIL]`, and
`Plan File: {path/to/tfplan}`. The saved `tfplan` and runtime data are allowed;
no findings-file writes. A saved binary plan is not a JSON summary artifact.
File JSON: caller `output_path`, `policy-precheck-v2`, plus the
`POLICY PRECHECK RESULT` text block, `Deploy gate: [PROCEED|BLOCK]` and
`Status: [CLEAN|INFORMATIONAL|BLOCKED|FAILED]`. If persistence fails, report it in
the failure text block without claiming a file was written. CLI JSON is input
evidence for the text summary, not a promised output artifact unless the caller
explicitly provides `output_path`.

### cost-estimate-subagent

Source: [agent Output format and Parent summary](../../../agents/_subagents/cost-estimate-subagent.agent.md).
File JSON: caller `output_path`, the documented cost JSON shape, plus
`COST ESTIMATE {COMPLETE | FAILED}` and `file_path` in the compact summary
(at most 15 lines and 2 KB). Preserve atomic writes and overwrite checks;
report persistence failure without claiming a file. Manifest writeback remains
limited to the worker's explicitly authorized price/timestamp fields.

### rubber-duck gated review

Source: [adversarial review protocol](../../apex-azure-defaults/references/adversarial-review-protocol.md).
For gated reviews, call `apex/reviewRequest`, pass the returned prompt to
`rubber-duck` exactly as given, then call `apex/recordReview` with the nonce.
The server writes schema 1.1 findings JSON and reports the recorded path. Do not
wrap the returned prompt, compute cache metadata, or write findings by hand.

For ungated reviews, call `rubber-duck` directly with the artifact path, lens and
matching checklist inline. Inline findings do not imply a findings-file write.

### Failure and recovery

Return command failures with the verbatim error, attempted activity, partial
output paths, and a next action for the parent. Do not fabricate success or
silently substitute tools, models, SKUs, or regions. Keep retries within the
recipient's existing bounded retry policy; do not add a new retry budget here.

For parent recovery, consult
[shared IaC patterns](../../apex-iac-common/SKILL.md). Required reviews and human
approval gates remain blocking even when a preview or validation succeeds.
