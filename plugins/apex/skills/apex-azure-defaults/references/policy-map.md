<!-- ref:policy-map-v1 -->

# Architecture Policy Map

The Architecture step owns the policy map for governance-first projects. It
connects every enforcing Azure Policy finding discovered by `04g-Governance` to
the designed component that complies, remediates, blocks, or is not applicable.

## Inputs

- `agent-output/{project}/04-governance-constraints.json`
- `agent-output/{project}/02-architecture-assessment.md`
- The component/resource list the Architect designed for Step 2

If governance constraints are missing on a governance-first project, stop and
return through `04g-Governance`; do not invent a policy map.

## Output Files

- Add `## 🗺️ Policy Map` to `02-architecture-assessment.md`.
- Write `agent-output/{project}/02-policy-map.json`.

`02-policy-map.json` uses `schema_version: "policy-map-v1"`:

```json
{
  "schema_version": "policy-map-v1",
  "project": "my-project",
  "constraints_sha256": "<sha256 of 04-governance-constraints.json bytes>",
  "components": [
    {
      "name": "api",
      "resource_type": "Microsoft.Web/sites"
    }
  ],
  "entries": [
    {
      "policy_key": "<assignment_id>#<policy_definition_reference_id or empty>",
      "assignment_id": "<assignment id>",
      "policy_definition_reference_id": "",
      "display_name": "<policy display name>",
      "effect": "deny",
      "component": "api",
      "property": "publicNetworkAccess",
      "disposition": "complies",
      "reason": "Public network access is disabled in the architecture."
    }
  ]
}
```

## Selection Rules

1. Read `04-governance-constraints.json` as bytes and compute its SHA-256 for
   `constraints_sha256`.
2. Build `components[]` from the architecture's designed Azure resources. Each
   component has a stable `name` and Azure `resource_type`.
3. Include every enforcing finding exactly once when:
   - `effect` is `deny`, `modify`, or `deployIfNotExists`; and
   - `enforcement_mode` is not `DoNotEnforce`.
4. Use `policy_key = assignment_id + "#" + policy_definition_reference_id`.
   Use an empty suffix after `#` when no policy-definition reference ID exists.

## Disposition Rules

Allowed `disposition` values:

- `complies`
- `remediated`
- `blocked`
- `not-applicable`

Rules:

- `complies`, `remediated`, and `blocked` entries require `component`.
- `blocked` entries are Step 2 findings. Raise them before approval.
- `not-applicable` requires `reason`, unless the finding has non-empty
  `resource_types` and none match any `components[].resource_type`.
- Do not mark a matching component as `not-applicable` without a factual reason.
- Use `property` for the architecture or Azure resource property affected by the
  policy. Use an empty string only when the property cannot be resolved.

## Architecture Artifact H2

In `## 🗺️ Policy Map`, include:

- The `constraints_sha256`.
- Summary counts by disposition.
- A table with policy display name, effect, component, property, disposition,
  and reason.
- A short findings list for every `blocked` row.

The Step 2 comprehensive architecture review covers this H2 and the JSON file.
Step 2 completion is blocked by the server when the map is missing or invalid;
fix the map rather than bypassing the gate.
