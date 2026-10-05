<!-- ref:reference-baseline-v1 -->

# ALZ Reference Baseline

The reference baseline is an offline fallback for governance-first projects when
no Azure subscription is available. It is generated from a pinned release of
`Azure/Azure-Landing-Zones-Library` and committed as
`references/alz-reference-baseline.json`.

## Scope

The maintainer generator reads these ALZ archetypes:

- `root`
- `landing_zones`
- `corp`

It resolves policy assignments from those archetypes into
`governance-constraints-v1` findings for enforcing effects:

- `deny`
- `modify`
- `deployIfNotExists`

Built-in definitions or initiative members that are not present in the ALZ
archive are retained in `reference_unresolved` for provenance. The baseline is
for architectural awareness only; it is not proof of the live target
subscription's Azure Policy state.

## Maintainer generation

```bash
node .github/skills/apex-azure-governance-discovery/scripts/generate-reference-baseline.mjs
```

The generator:

1. Downloads the pinned ALZ archive.
2. Verifies the archive SHA-256 before reading it.
3. Produces deterministic JSON bytes.
4. Writes a schema-valid `governance-constraints-v1` envelope with
   `source: "reference"`.

For offline regeneration or tests, pass a local archive:

```bash
node .github/skills/apex-azure-governance-discovery/scripts/generate-reference-baseline.mjs \
    --archive tmp/alz.tar.gz \
    --out .github/skills/apex-azure-governance-discovery/references/alz-reference-baseline.json
```

Current pinned release:

| Field | Value |
| --- | --- |
| Library | `Azure/Azure-Landing-Zones-Library` |
| Tag | `platform/alz/2026.08.1` |
| Archive SHA-256 | `4cd9dc11e7f81b86db76182d93c0d68cea900476660cac478d77943341cfab25` |

## Project import

Use the Node importer when no subscription is available:

```bash
node .github/skills/apex-azure-governance-discovery/scripts/import-reference-baseline.mjs \
    --project my-project \
    --out agent-output/my-project/04-governance-constraints.json
```

The importer locates `references/alz-reference-baseline.json` relative to the
script path. It never relies on `PLUGIN_ROOT`, process-specific plugin paths, or
the caller's current working directory.

After import, record:

```text
governance_baseline = reference
```

The importer preserves `discovered_at`, `discovery_metadata.reference.tag`, and
`discovery_metadata.reference.generated_at` from the committed data. It must not
stamp the current clock time into project output.

## Step 4 guardrail

A reference baseline can unblock Architecture, but it cannot authorize IaC
planning or code generation. Before Step 4 / IaC Plan, replace the project file
with live `discover.mjs` output and record:

```text
governance_baseline = live
```
