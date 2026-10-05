#!/usr/bin/env node
/** Generate the pinned ALZ reference governance baseline. */

import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUT_PATH = path.join(SKILL_DIR, "references", "alz-reference-baseline.json");

export const ALZ_LIBRARY = {
  owner: "Azure",
  repo: "Azure-Landing-Zones-Library",
  tag: "platform/alz/2026.08.1",
  archiveUrl:
    "https://codeload.github.com/Azure/Azure-Landing-Zones-Library/tar.gz/refs/tags/platform/alz/2026.08.1",
  archiveSha256: "4cd9dc11e7f81b86db76182d93c0d68cea900476660cac478d77943341cfab25",
  releasePublishedAt: "2026-08-27T05:16:32Z",
  archetypes: ["root", "landing_zones", "corp"],
};

const SCHEMA_VERSION = "governance-constraints-v1";
const REFERENCE_SUBSCRIPTION_ID = "unknown";
const REFERENCE_SCOPE = "/providers/Microsoft.Management/managementGroups/alz-reference";
const DEFAULT_TTL_DAYS = 7;
const API_VERSIONS = {
  policyAssignments: "2024-04-01",
  policyDefinitions: "2021-06-01",
  policyExemptions: "2022-07-01-preview",
};

const EFFECTS = new Map([
  ["append", "append"],
  ["audit", "audit"],
  ["auditifnotexists", "auditIfNotExists"],
  ["deny", "deny"],
  ["deployifnotexists", "deployIfNotExists"],
  ["disabled", "disabled"],
  ["modify", "modify"],
]);
const FINDING_EFFECTS = new Set(["deny", "deployIfNotExists", "modify"]);

const BICEP_TYPE_OVERRIDES = {
  "Microsoft.Storage/storageAccounts": "storageAccounts",
  "Microsoft.Sql/servers": "sqlServers",
  "Microsoft.Sql/servers/databases": "sqlServers/databases",
  "Microsoft.KeyVault/vaults": "keyVaults",
  "Microsoft.Web/sites": "sites",
  "Microsoft.Network/virtualNetworks": "virtualNetworks",
  "Microsoft.Compute/virtualMachines": "virtualMachines",
  "Microsoft.Resources/subscriptions/resourceGroups": "resourceGroups",
};

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function parseArgs(argv) {
  const args = {
    archivePath: null,
    expectedSha256: ALZ_LIBRARY.archiveSha256,
    outPath: DEFAULT_OUT_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--archive") args.archivePath = next();
    else if (arg === "--expected-sha256") args.expectedSha256 = next().toLowerCase();
    else if (arg === "--out") args.outPath = next();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node ${path.relative(process.cwd(), SCRIPT_PATH)} [options]

Options:
  --archive <path>          Use a local Azure Landing Zones Library .tar.gz archive.
  --expected-sha256 <hex>   Expected archive digest. Defaults to the pinned release digest.
  --out <path>              Output JSON path. Defaults to references/alz-reference-baseline.json.
  -h, --help                Show this help.
`);
}

async function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          download(new URL(response.headers.location, url).toString()).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function parseTarGz(buffer) {
  const tar = gunzipSync(buffer);
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header, 0, 100);
    const sizeText = readTarString(header, 124, 12).trim();
    const type = readTarString(header, 156, 1) || "0";
    const prefix = readTarString(header, 345, 155);
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`Invalid tar entry size for ${name}`);
    }
    offset += 512;
    const fullName = normalizeTarPath(prefix ? `${prefix}/${name}` : name);
    if (type === "0" || type === "") {
      const withoutRoot = fullName.split("/").slice(1).join("/");
      files.set(withoutRoot, tar.subarray(offset, offset + size).toString("utf8"));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function readTarString(buffer, start, length) {
  const raw = buffer.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
}

function normalizeTarPath(value) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function readJson(files, relativePath) {
  const content = files.get(relativePath);
  if (content === undefined) throw new Error(`Archive is missing ${relativePath}`);
  return JSON.parse(content);
}

function parseJsonEntries(files, directory, suffix) {
  const entries = new Map();
  for (const [filePath, content] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!filePath.startsWith(`${directory}/`) || !filePath.endsWith(suffix)) continue;
    const parsed = JSON.parse(content);
    if (typeof parsed.name !== "string" || parsed.name.length === 0) {
      throw new Error(`${filePath} is missing name`);
    }
    entries.set(parsed.name.toLowerCase(), parsed);
  }
  return entries;
}

function unwrapParameterValues(parameters = {}) {
  const values = {};
  for (const [name, entry] of Object.entries(parameters ?? {})) {
    values[name] = entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
  }
  return values;
}

function parameterDefaults(definition) {
  const parameters = definition?.properties?.parameters ?? {};
  const values = {};
  for (const [name, entry] of Object.entries(parameters)) {
    if (entry && typeof entry === "object" && "defaultValue" in entry) values[name] = entry.defaultValue;
  }
  return values;
}

function caseInsensitiveGet(values, name) {
  const key = Object.keys(values).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : values[key];
}

function resolveParameterExpression(value, parameters) {
  if (typeof value !== "string") return value;
  const match = /^\[parameters\('([^']+)'\)\]$/i.exec(value.trim());
  if (!match) return value;
  const resolved = caseInsensitiveGet(parameters, match[1]);
  return resolved === undefined ? value : resolved;
}

function resolveSuppliedParameters(supplied = {}, parameters = {}) {
  const values = {};
  for (const [name, entry] of Object.entries(supplied ?? {})) {
    const raw = entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
    values[name] = resolveParameterExpression(raw, parameters);
  }
  return values;
}

function effectiveParameters(definition, supplied = {}) {
  return { ...parameterDefaults(definition), ...unwrapParameterValues(supplied) };
}

function normalizeEffect(value) {
  if (typeof value !== "string") return null;
  return EFFECTS.get(value.trim().toLowerCase()) ?? null;
}

function effectFromPolicyRule(definition, parameters) {
  const raw = definition?.properties?.policyRule?.then?.effect;
  return normalizeEffect(resolveParameterExpression(raw, parameters));
}

function inferBuiltInEffect(assignment) {
  const effect = normalizeEffect(assignment?.properties?.parameters?.effect?.value);
  if (effect) return { effect, source: "assignment-parameter" };
  const name = `${assignment?.name ?? ""} ${assignment?.properties?.displayName ?? ""}`.toLowerCase();
  if (name.startsWith("deny") || name.includes(" deny ")) return { effect: "deny", source: "assignment-name" };
  if (name.startsWith("modify") || name.includes(" modify ")) return { effect: "modify", source: "assignment-name" };
  if (name.startsWith("deploy") || name.includes(" deploy ")) {
    return { effect: "deployIfNotExists", source: "assignment-name" };
  }
  return { effect: null, source: "unresolved" };
}

function classificationFor(effect) {
  if (effect === "deny") return "blocker";
  if (effect === "deployIfNotExists" || effect === "modify") return "auto-remediate";
  return "informational";
}

function policyNameFromId(policyDefinitionId) {
  return String(policyDefinitionId ?? "").split("/").filter(Boolean).pop() ?? "";
}

function isPolicySetId(policyDefinitionId) {
  return String(policyDefinitionId ?? "").toLowerCase().includes("/policysetdefinitions/");
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
}

function compactPolicyTuple(finding) {
  const tuple = {
    policy_id: finding.policy_id ?? "",
    effect: finding.effect ?? "",
    scope: finding.scope ?? "",
    params: finding.assignment_parameters ?? {},
  };
  for (const key of ["assignment_id", "policy_definition_reference_id"]) {
    if (finding[key] !== undefined && finding[key] !== null) tuple[key] = finding[key];
  }
  return tuple;
}

function completenessSignature(findings) {
  const serialized = findings
    .map(compactPolicyTuple)
    .sort((left, right) => {
      const byId = left.policy_id.localeCompare(right.policy_id);
      if (byId !== 0) return byId;
      return JSON.stringify(left, Object.keys(left).sort()).localeCompare(JSON.stringify(right, Object.keys(right).sort()));
    })
    .map((tuple) => JSON.stringify(sortValue(tuple)))
    .join("\n");
  return `sha256:${crypto.createHash("sha256").update(serialized).digest("hex")}`;
}

function collectResourceTypes(node, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectResourceTypes(item, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const field = typeof node.field === "string" ? node.field.toLowerCase() : "";
  if (field === "type") {
    for (const key of ["equals", "notEquals"]) {
      if (typeof node[key] === "string" && node[key].includes("/")) found.add(node[key]);
    }
    for (const key of ["in", "notIn"]) {
      if (Array.isArray(node[key])) {
        for (const value of node[key]) if (typeof value === "string" && value.includes("/")) found.add(value);
      }
    }
  }
  for (const value of Object.values(node)) collectResourceTypes(value, found);
  return found;
}

function collectPolicyFields(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectPolicyFields(item, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  if (typeof node.field === "string") found.push(node.field);
  for (const value of Object.values(node)) collectPolicyFields(value, found);
  return found;
}

function propertyPaths(definition, resourceTypes) {
  const fields = collectPolicyFields(definition?.properties?.policyRule?.if ?? {});
  const azureField = fields.find((field) => !["type", "location", "name", "kind"].includes(field.toLowerCase())) ?? "";
  if (!azureField || resourceTypes.length === 0) {
    return { azurePropertyPath: azureField, bicepPropertyPath: "" };
  }
  const resourceType = resourceTypes[0];
  const bicepType = BICEP_TYPE_OVERRIDES[resourceType] ?? resourceType;
  const suffix = azureField.startsWith(`${resourceType}/`) ? azureField.slice(resourceType.length + 1) : azureField;
  return { azurePropertyPath: azureField, bicepPropertyPath: `${bicepType}::${suffix}` };
}

function requiredValue(definition, parameters) {
  const entries = Object.entries(parameters).filter(([name]) => name.toLowerCase() !== "effect");
  if (entries.length === 1) return entries[0][1];
  if (entries.length > 1) return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
  const fields = collectPolicyFields(definition?.properties?.policyRule?.if ?? {});
  return fields.length > 0 ? fields[0] : "";
}

function createFinding({ assignment, archetypes, definition, effect, effectSource, memberRefId, suppliedParameters }) {
  const resourceTypes = [...collectResourceTypes(definition?.properties?.policyRule?.if ?? {})].sort();
  const paths = propertyPaths(definition, resourceTypes);
  const policyId = definition?.id ?? definition?.name ?? assignment.properties.policyDefinitionId;
  const displayName = definition?.properties?.displayName ?? assignment.properties.displayName ?? assignment.name;
  const category = definition?.properties?.metadata?.category ?? assignment.properties.metadata?.category ?? "Uncategorized";
  const parameters = effectiveParameters(definition, suppliedParameters);
  return {
    policy_id: policyId,
    display_name: displayName,
    effect,
    scope: assignment.properties.scope ?? REFERENCE_SCOPE,
    assignment_display_name: assignment.properties.displayName ?? assignment.name,
    assignment_id: `/providers/Microsoft.Management/managementGroups/alz-reference/providers/Microsoft.Authorization/policyAssignments/${assignment.name}`,
    policy_definition_reference_id: memberRefId ?? null,
    not_scopes: assignment.properties.notScopes ?? [],
    resource_selectors: assignment.properties.resourceSelectors ?? [],
    enforcement_mode: assignment.properties.enforcementMode ?? "Default",
    classification: classificationFor(effect),
    category,
    resource_types: resourceTypes,
    required_value: requiredValue(definition, parameters),
    azurePropertyPath: paths.azurePropertyPath,
    bicepPropertyPath: paths.bicepPropertyPath,
    exemption: null,
    override: null,
    assignment_parameters: sortValue(parameters),
    reference_archetypes: archetypes,
    reference_effect_source: effectSource,
  };
}

function localDefinitionById(policyDefinitionId, policyDefinitions) {
  return policyDefinitions.get(policyNameFromId(policyDefinitionId).toLowerCase()) ?? null;
}

function localPolicySetById(policyDefinitionId, policySets) {
  return policySets.get(policyNameFromId(policyDefinitionId).toLowerCase()) ?? null;
}

function resolveAssignment({ assignment, archetypes, policyDefinitions, policySets }) {
  const policyDefinitionId = assignment.properties.policyDefinitionId;
  const findings = [];
  const memberPolicyIds = [];
  const unresolved = [];
  if (isPolicySetId(policyDefinitionId)) {
    const setDefinition = localPolicySetById(policyDefinitionId, policySets);
    if (!setDefinition) {
      const inferred = inferBuiltInEffect(assignment);
      if (inferred.effect && FINDING_EFFECTS.has(inferred.effect)) {
        const placeholder = {
          id: policyDefinitionId,
          name: policyNameFromId(policyDefinitionId),
          properties: {
            displayName: assignment.properties.displayName ?? assignment.name,
            metadata: { category: assignment.properties.metadata?.category ?? "Built-in initiative" },
            parameters: {},
            policyRule: { if: {}, then: { effect: inferred.effect } },
          },
        };
        findings.push(
          createFinding({
            assignment,
            archetypes,
            definition: placeholder,
            effect: inferred.effect,
            effectSource: inferred.source,
            memberRefId: null,
            suppliedParameters: {},
          }),
        );
      } else {
        unresolved.push({ assignment: assignment.name, policyDefinitionId, reason: "built-in initiative not in ALZ archive" });
      }
      return { findings, memberPolicyIds: [policyDefinitionId.toLowerCase()], unresolved };
    }
    const setParameters = { ...parameterDefaults(setDefinition), ...unwrapParameterValues(assignment.properties.parameters) };
    for (const member of setDefinition.properties.policyDefinitions ?? []) {
      const definition = localDefinitionById(member.policyDefinitionId, policyDefinitions);
      memberPolicyIds.push(String(member.policyDefinitionId).toLowerCase());
      if (!definition) {
        unresolved.push({
          assignment: assignment.name,
          policyDefinitionId: member.policyDefinitionId,
          reason: "initiative member definition not in ALZ archive",
        });
        continue;
      }
      const supplied = resolveSuppliedParameters(member.parameters ?? {}, setParameters);
      const parameters = effectiveParameters(definition, supplied);
      const effect = effectFromPolicyRule(definition, parameters) ?? normalizeEffect(parameters.effect);
      if (!effect) {
        unresolved.push({ assignment: assignment.name, policyDefinitionId: member.policyDefinitionId, reason: "effect unresolved" });
        continue;
      }
      if (FINDING_EFFECTS.has(effect)) {
        findings.push(
          createFinding({
            assignment,
            archetypes,
            definition,
            effect,
            effectSource: "initiative-member",
            memberRefId: member.policyDefinitionReferenceId ?? null,
            suppliedParameters: supplied,
          }),
        );
      }
    }
    return { findings, memberPolicyIds, unresolved };
  }

  const definition = localDefinitionById(policyDefinitionId, policyDefinitions);
  memberPolicyIds.push(String(policyDefinitionId).toLowerCase());
  if (!definition) {
    const inferred = inferBuiltInEffect(assignment);
    if (!inferred.effect) {
      return {
        findings,
        memberPolicyIds,
        unresolved: [{ assignment: assignment.name, policyDefinitionId, reason: "built-in definition effect unresolved" }],
      };
    }
    if (FINDING_EFFECTS.has(inferred.effect)) {
      const placeholder = {
        id: policyDefinitionId,
        name: policyNameFromId(policyDefinitionId),
        properties: {
          displayName: assignment.properties.displayName ?? assignment.name,
          metadata: { category: assignment.properties.metadata?.category ?? "Built-in policy" },
          parameters: {},
          policyRule: { if: {}, then: { effect: inferred.effect } },
        },
      };
      findings.push(
        createFinding({
          assignment,
          archetypes,
          definition: placeholder,
          effect: inferred.effect,
          effectSource: inferred.source,
          memberRefId: null,
          suppliedParameters: assignment.properties.parameters ?? {},
        }),
      );
    }
    return { findings, memberPolicyIds, unresolved };
  }

  const parameters = effectiveParameters(definition, assignment.properties.parameters);
  const effect = effectFromPolicyRule(definition, parameters) ?? normalizeEffect(parameters.effect);
  if (!effect) {
    return {
      findings,
      memberPolicyIds,
      unresolved: [{ assignment: assignment.name, policyDefinitionId, reason: "effect unresolved" }],
    };
  }
  if (FINDING_EFFECTS.has(effect)) {
    findings.push(
      createFinding({
        assignment,
        archetypes,
        definition,
        effect,
        effectSource: "policy-definition",
        memberRefId: null,
        suppliedParameters: assignment.properties.parameters ?? {},
      }),
    );
  }
  return { findings, memberPolicyIds, unresolved };
}

function buildArchetypeAssignmentMap(files) {
  const assignmentToArchetypes = new Map();
  for (const archetype of ALZ_LIBRARY.archetypes) {
    const definition = readJson(
      files,
      `platform/alz/archetype_definitions/${archetype}.alz_archetype_definition.json`,
    );
    for (const assignment of definition.policy_assignments ?? []) {
      const archetypes = assignmentToArchetypes.get(assignment) ?? [];
      archetypes.push(archetype);
      assignmentToArchetypes.set(assignment, archetypes);
    }
  }
  return new Map([...assignmentToArchetypes.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function extractTagsRequired(findings) {
  const tags = new Map();
  for (const finding of findings) {
    const values = finding.assignment_parameters ?? {};
    for (const [name, value] of Object.entries(values)) {
      if (/tag(name|key)/i.test(name) && typeof value === "string" && value.length > 0) {
        tags.set(value.toLowerCase(), { name: value });
      }
    }
  }
  return [...tags.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function extractAllowedLocations(findings) {
  const locationLists = findings
    .filter((finding) => finding.effect === "deny")
    .flatMap((finding) => {
      const values = Object.entries(finding.assignment_parameters ?? {})
        .filter(([name, value]) => /location/i.test(name) && Array.isArray(value))
        .map(([, value]) => value);
      return values;
    });
  if (locationLists.length === 0) return [];
  const [first, ...rest] = locationLists.map((items) => new Set(items.map((item) => String(item).toLowerCase())));
  return [...first].filter((item) => rest.every((set) => set.has(item))).sort();
}

function buildEnvelope(files, archiveDigest, options = {}) {
  const policyDefinitions = parseJsonEntries(
    files,
    "platform/alz/policy_definitions",
    ".alz_policy_definition.json",
  );
  const policySets = parseJsonEntries(
    files,
    "platform/alz/policy_set_definitions",
    ".alz_policy_set_definition.json",
  );
  const assignmentMap = buildArchetypeAssignmentMap(files);
  const findings = [];
  const assignmentInventory = [];
  const memberPolicyIndex = new Set();
  const unresolved = [];
  let auditCount = 0;
  let disabledCount = 0;
  let assignmentTotal = 0;

  for (const [assignmentName, archetypes] of assignmentMap.entries()) {
    const assignment = readJson(
      files,
      `platform/alz/policy_assignments/${assignmentName}.alz_policy_assignment.json`,
    );
    assignmentTotal += 1;
    assignmentInventory.push({
      displayName: assignment.properties.displayName ?? assignment.name,
      scope: assignment.properties.scope ?? REFERENCE_SCOPE,
      assignmentType: "reference",
      policyDefinitionId: String(assignment.properties.policyDefinitionId ?? "").toLowerCase(),
      reference_archetypes: archetypes,
    });
    const resolved = resolveAssignment({ assignment, archetypes, policyDefinitions, policySets });
    for (const policyId of resolved.memberPolicyIds) memberPolicyIndex.add(policyId);
    unresolved.push(...resolved.unresolved);
    for (const finding of resolved.findings) findings.push(finding);
    for (const finding of resolved.findings) {
      if (finding.effect === "audit" || finding.effect === "auditIfNotExists") auditCount += 1;
      if (finding.effect === "disabled") disabledCount += 1;
    }
  }

  findings.sort((left, right) => {
    const byAssignment = left.assignment_id.localeCompare(right.assignment_id);
    if (byAssignment !== 0) return byAssignment;
    const byPolicy = left.policy_id.localeCompare(right.policy_id);
    if (byPolicy !== 0) return byPolicy;
    return String(left.policy_definition_reference_id ?? "").localeCompare(String(right.policy_definition_reference_id ?? ""));
  });

  const discoveredAt = options.generatedAt ?? ALZ_LIBRARY.releasePublishedAt;
  const metadata = {
    discovery_status: "COMPLETE",
    discovered_at: discoveredAt,
    scope: {
      subscription_id: REFERENCE_SUBSCRIPTION_ID,
      management_groups: ["alz-reference"],
    },
    api_versions: API_VERSIONS,
    page_counts: {
      policyAssignments: assignmentTotal,
      policyDefinitions: policyDefinitions.size + policySets.size,
      policyExemptions: 0,
    },
    completeness_signature: completenessSignature(findings),
    ttl_days: DEFAULT_TTL_DAYS,
    reference: {
      source: "reference",
      library: `${ALZ_LIBRARY.owner}/${ALZ_LIBRARY.repo}`,
      tag: ALZ_LIBRARY.tag,
      archive_url: options.archiveUrl ?? ALZ_LIBRARY.archiveUrl,
      archive_sha256: archiveDigest,
      generated_at: discoveredAt,
      archetypes: ALZ_LIBRARY.archetypes,
    },
  };
  const blockers = findings.filter((finding) => finding.classification === "blocker").length;
  const autoRemediate = findings.filter((finding) => finding.classification === "auto-remediate").length;
  return {
    schema_version: SCHEMA_VERSION,
    project: "reference",
    subscription_id: REFERENCE_SUBSCRIPTION_ID,
    discovered_at: discoveredAt,
    source: "reference",
    discovery_status: "COMPLETE",
    discovery_metadata: metadata,
    reference_metadata: metadata.reference,
    discovery_summary: {
      assignment_total: assignmentTotal,
      assignment_kept: assignmentTotal,
      defender_auto_filtered: 0,
      subscription_scope_count: 0,
      management_group_inherited_count: assignmentTotal,
      blocker_count: blockers,
      auto_remediate_count: autoRemediate,
      informational_count: findings.length - blockers - autoRemediate,
      audit_count: auditCount,
      disabled_count: disabledCount,
      exempted_count: 0,
      unresolved_reference_count: unresolved.length,
    },
    assignment_inventory: assignmentInventory.sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    ),
    findings,
    policies: findings,
    member_policy_index: [...memberPolicyIndex].sort(),
    tags_required: extractTagsRequired(findings),
    allowed_locations: extractAllowedLocations(findings),
    reference_unresolved: unresolved.sort((left, right) =>
      `${left.assignment}:${left.policyDefinitionId}`.localeCompare(`${right.assignment}:${right.policyDefinitionId}`),
    ),
  };
}

export function generateReferenceBaselineFromArchiveBuffer(buffer, options = {}) {
  const digest = sha256(buffer);
  const expected = (options.expectedSha256 ?? ALZ_LIBRARY.archiveSha256).toLowerCase();
  if (digest !== expected) {
    throw new Error(`Archive sha256 mismatch: expected ${expected}, got ${digest}`);
  }
  return sortValue(buildEnvelope(parseTarGz(buffer), digest, options));
}

export function generateReferenceBaselineFromArchive(archivePath, options = {}) {
  const buffer = fs.readFileSync(archivePath);
  return generateReferenceBaselineFromArchiveBuffer(buffer, options);
}

export async function runGenerator(options = {}) {
  const outPath = path.resolve(options.outPath ?? DEFAULT_OUT_PATH);
  let buffer;
  if (options.archivePath) {
    buffer = fs.readFileSync(options.archivePath);
  } else {
    buffer = await download(options.archiveUrl ?? ALZ_LIBRARY.archiveUrl);
    const cachePath = path.join(os.tmpdir(), `alz-reference-${ALZ_LIBRARY.tag.replaceAll("/", "-")}.tar.gz`);
    fs.writeFileSync(cachePath, buffer);
  }
  const envelope = generateReferenceBaselineFromArchiveBuffer(buffer, {
    archiveUrl: options.archiveUrl ?? ALZ_LIBRARY.archiveUrl,
    expectedSha256: options.expectedSha256 ?? ALZ_LIBRARY.archiveSha256,
    generatedAt: options.generatedAt ?? ALZ_LIBRARY.releasePublishedAt,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${stableStringify(envelope)}\n`);
  const effectCounts = Object.fromEntries(
    [...new Set(envelope.findings.map((finding) => finding.effect))]
      .sort()
      .map((effect) => [effect, envelope.findings.filter((finding) => finding.effect === effect).length]),
  );
  console.log(
    JSON.stringify({
      status: "COMPLETE",
      out_path: outPath,
      library_tag: ALZ_LIBRARY.tag,
      archive_sha256: envelope.reference_metadata.archive_sha256,
      findings: envelope.findings.length,
      effect_counts: effectCounts,
    }),
  );
  return envelope;
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (invokedAsScript) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      await runGenerator(args);
    }
  } catch (error) {
    console.error(`generate-reference-baseline error: ${error.message}`);
    process.exitCode = 2;
  }
}
