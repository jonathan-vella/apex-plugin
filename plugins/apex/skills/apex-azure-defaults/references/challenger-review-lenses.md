<!-- ref:challenger-review-lenses-v1 -->

# Challenger Review Lenses

Detailed lens, category, severity, checklist and rule guidance moved from the
challenger-review subagent. The worker body keeps input validation, file-output,
summary and JSON-schema contracts.

## Review Focus Lenses

When `review_focus` is set, concentrate adversarial energy on that lens:

- **`security-governance`** — Governance gaps, policy mapping, TLS/HTTPS/MI enforcement, RBAC, secrets management
- **`architecture-reliability`** — SLA achievability, RTO/RPO validation, SPOF analysis, dependency ordering, WAF balance
- **`cost-feasibility`** — SKU-to-requirement mismatch,
  hidden costs (egress/transactions/logs), free-tier risk, budget alignment
- **`comprehensive`** — Single-pass merged lens combining the three above.
  Default for the orchestrated flow at Steps 1, 2, 4. Accepts
  `artifact_type` of `requirements`, `architecture`, `cost-estimate`,
  `implementation-plan`, `iac-code`, `design-adr`.

## Analysis Categories

**Core** (all artifact types): Untested Assumption · Missing Failure Mode · Hidden Dependency ·
Scope Risk · Architectural Weakness · Governance Gap · WAF Blind Spot.

**Additional categories by artifact type** → Read `.github/skills/apex-azure-defaults/references/artifact-type-categories.md`

## Severity Levels

- **must_fix**: Will cause **deployment failure** (Azure Policy Deny block, missing required config,
  broken dependency chain) or **security breach** (public data exposure, no authentication,
  plaintext secrets, missing encryption). Must be fixable in the current step's artifact.
- **should_fix**: Violates WAF best practice or creates **operational risk** that won't block
  deployment but degrades production quality (missing alerts, single points of failure,
  incomplete diagnostics). Must be addressable in the current step.
- **suggestion**: Nice-to-have improvement, belongs in a later step (e.g., Step 7 as-built docs),
  or is a "consider for v2" item. Use for: failover-region design, certificate lifecycle docs,
  post-launch right-sizing checkpoints, operational runbook content.

> **Severity calibration rule**: If a finding describes content that belongs in
> Step 7 (as-built documentation, ops runbook, DR plan), classify it as `suggestion`,
> not `should_fix`. The plan/code is a deployment blueprint, not an ops manual.

## Adversarial Checklists

Read `.github/skills/apex-azure-defaults/references/adversarial-checklists.md` for the full
per-category and per-artifact-type checklists, plus Azure Infrastructure Skepticism Surfaces.

## Reference Index

| Reference                                    | Path                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Adversarial checklists & skepticism surfaces | `.github/skills/apex-azure-defaults/references/adversarial-checklists.md`      |
| Artifact-type-specific categories            | `.github/skills/apex-azure-defaults/references/artifact-type-categories.md`    |
| Adversarial review protocol                  | `.github/skills/apex-azure-defaults/references/adversarial-review-protocol.md` |
| Golden Principles                            | `.github/skills/apex-golden-principles/SKILL.md`                               |


## Rules

1. **Enumerate every applicable location** — when a rule applies to
   multiple places in the artifact (e.g. AVM pins appearing in summary
   tables AND in N task YAML blocks; diagnostic settings on every
   resource family), the finding MUST list every location in
   `verification_anchors[]`. A finding that only cites the first
   occurrence is incomplete and causes partial-fix loops between
   review passes. This applies in priority order for all rules.
2. **Be adversarial, not obstructive** — find real risks, not style preferences
3. **Propose specific failure scenarios** — "if Deny policy X blocks resource Y, deployment fails at step Z"
4. **Suggest mitigations, not just problems** — every issue must have an actionable mitigation
5. **Focus on high-impact risks** — ignore purely theoretical issues with no evidence
6. **Challenge assumptions, not decisions** — question the assumptions behind explicit choices
7. **Calibrate severity carefully** — must_fix = likely fails; should_fix = significant risk; suggestion = worth considering
8. **Verify before claiming** — use search tools to confirm assumptions before labelling as risks
9. **Read prior artifacts** — avoid challenging something already resolved
10. **Cross-reference governance** — verify artifact respects ALL discovered policies in `04-governance-constraints.json`
11. **Prior findings** — deduplicate unchanged-artifact lens passes, but verify closure and retain blockers on revisions

