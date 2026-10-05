<!-- ref:adversarial-review-deep-v1 -->
---
name: Adversarial Review — Deep Cascade
description: Opt-in multi-pass deep-review cascade for rubber-duck reviews
---

# Opt-in: Deep adversarial review

Sibling of [`adversarial-review-protocol.md`](./adversarial-review-protocol.md).
The default-flow rules (severity guardrails, per-finding decision protocol,
context shredding, approval-gate template, findings cache) stay in the
parent file. This file holds **only the deep-review cascade** so the
default flow doesn't carry it in every system-prompt replay (per
`tmp/plan-input-token-reduction-v3.md` Phase 9).

Load this file only when **any** of these conditions hold:

- `decisions.review_depth == "deep"` (project-scoped, captured by
  01-Orchestrator).
- User explicitly invokes `10-Challenger` with multi-pass arguments.
- User picks the deep-review option at a gate prompt (only offered at
  Step 2, Step 4, Step 5b/5t).

## Rotating-lens passes

| Pass | `review_focus`             | Condition                                                 |
| ---- | -------------------------- | --------------------------------------------------------- |
| 1    | `security-governance`      | Always required when deep review is active                |
| 2    | `architecture-reliability` | Skip if pass 1 returns 0 `must_fix` AND `<2` `should_fix` |
| 3    | `cost-feasibility`         | Skip if pass 2 returns 0 `must_fix`                       |

Pass 1 is always run when deep review is active; passes 2 and 3 cascade
per the early-exit gate above. Log skipped passes via
`apex/reviewAudit`.

## Recommended tier shape (read from `opt_in_matrix`)

`workflow-graph.json` carries `opt_in_matrix` per step. **Treat the
matrix as a recommendation**, not a forced shape:

| Tier (`decisions.complexity`) | Recommended deep-review shape                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `simple`                      | 1 pass (`comprehensive`)                                                           |
| `standard`                    | 2 passes (`security-governance` → `architecture-reliability`)                      |
| `complex`                     | 3 passes (`security-governance` → `architecture-reliability` → `cost-feasibility`) |

The orchestrator does **not** auto-fire any of these — they apply only
when deep review is already active. `opt_in_matrix` MAY be partial — a
missing tier means "no recommended multi-pass shape; run the standard
deep-review cascade above".

## Per-pass invocation template (deep review)

For each pass, call `apex/reviewRequest`, then invoke `rubber-duck` through
the available delegation capability with the returned prompt exactly as given.
After the reviewer returns, call `apex/recordReview` with the returned `nonce`.
If unavailable, stop and request a human handoff to `10-Challenger` under the
parent protocol; never use a nested wrapper fallback.

- Pass 1: request the canonical or first deep artifact review as directed by
  the owning agent.
- Pass 2: call `apex/reviewRequest` with `kind: deep` and `pass: 2`.
- Pass 3: call `apex/reviewRequest` with `kind: deep` and `pass: 3`.

Each pass is a separate `rubber-duck` call and a separate `apex/recordReview`
import. Do not batch pass 2 + 3, even for complex projects. The server writes
each result to the appropriate `challenge-findings-*-pass{N}.json` sidecar.

Default-flow rules (single-pass `comprehensive` invocation, mandatory-floor
gates, reviewer-unavailable fallback, severity guardrails, per-finding
decision protocol) stay in
[`adversarial-review-protocol.md`](./adversarial-review-protocol.md).
