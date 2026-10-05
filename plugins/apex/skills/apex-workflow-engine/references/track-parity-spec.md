<!-- ref:track-parity-spec-v1 -->

# Track Parity Normalization Spec (B4)

> Spec for the `workflow-handoff-track-parity-001` rule
> (`tools/scripts/validate-agents.mjs`). Compares Bicep- and
> Terraform-track agents structurally so cosmetic naming differences
> don't trigger false positives, but real divergence does.

## Compared pairs

| Track A (Bicep)     | Track B (Terraform)     | Role    |
| ------------------- | ----------------------- | ------- |
| `06-IaC CodeGen` | `06-IaC CodeGen` | codegen |
| `07-IaC Deploy`  | `07-IaC Deploy`  | deploy  |

Test hook: set
`WORKFLOW_HANDOFFS_TEST_TRACK_PAIRS='[["agent-A","agent-B"]]'` (JSON)
to inject extra pairs without disturbing production checks.

## Tuple shape

For each `handoffs[i]` on a tracked agent, build a comparison tuple:

```text
{ label, target }
```

- **label**: handoff label with track tokens stripped:
  `\b(Bicep|Terraform|TF|terraform|bicep|tf)\b` removed,
  multiple spaces collapsed.
  Tool-native verb pairs are also canonicalized so semantically
  equivalent labels match: `What-If` ↔ `Plan` → `Preview`
  (Azure ARM `what-if` and `terraform plan` both produce a
  deploy-preview report). Future synonyms can be added here when
  tool vocabulary diverges further.
- **target**: handoff target after `normalizeTrackTarget()`:
  - `06[bt]-…` → `"codegen"`
  - `07[bt]-…` → `"deploy"`
  - `iac-preview-subagent` ↔ `iac-preview-subagent` → `"preview-subagent"`
  - `iac-validate-subagent` ↔ `iac-validate-subagent` → `"validate-subagent"`
  - everything else: pass-through.

> **Note**: Earlier drafts of this spec included a `kind:` field per
> handoff. That field was rejected by VS Code Copilot's handoff
> schema and removed. The structural `(label, target)` tuple
> comparison is sufficient for parity checking.

## Comparison

Two agents pass parity when their tuple **multisets** are equal
(label×target keys). The validator emits one finding per tuple
present on one side but not the other:

```text
[A] has tuple [<label>|<target>] not present in [B]
[B] has tuple [<label>|<target>] not present in [A]
```

Plus a single count-mismatch finding when `len(A) != len(B)`.

## Examples

### Pass

| Bicep handoff label            | Terraform handoff label          | Normalized           | Status |
| ------------------------------ | -------------------------------- | -------------------- | ------ |
| `▶ Run What-If`                | `▶ Run What-If`                  | `▶ Run Preview`      | ✅     |
| `Step 6: Deploy Bicep`         | `Step 6: Deploy Terraform`       | `Step 6: Deploy`     | ✅     |
| `agent: iac-preview-subagent` | `agent: iac-preview-subagent` | `preview-subagent`   | ✅     |
| `▶ Run What-If Only`           | `▶ Run Plan Only`                | `▶ Run Preview Only` | ✅     |

### Fail (resolved 2026-05-09)

`07-IaC Deploy` had `▶ Run What-If Only` →
normalized label `▶ Run What-If Only`.
`07-IaC Deploy` had `▶ Run Plan Only` →
normalized label `▶ Run Plan Only`.

After token strip alone the labels still differed ("What-If" vs
"Plan"), so the tuples didn't match → finding fired. **Resolved**
in [\_lib/workflow-handoffs.mjs](../../../../tools/scripts/_lib/workflow-handoffs.mjs)
by adding `What-If` ↔ `Plan` → `Preview` to `normalizeTrackLabel`.
Both labels now normalize to `▶ Run Preview Only`. New tool-native
verb pairs can be added the same way.

## Why this design

A naïve string-compare would flag every Bicep/Terraform agent due
to the literal track tokens in labels. A target-name compare alone
would miss cases where one track has more handoffs than the other.
The structural multiset comparison flags both shape and content
divergence while tolerating cosmetic differences.
