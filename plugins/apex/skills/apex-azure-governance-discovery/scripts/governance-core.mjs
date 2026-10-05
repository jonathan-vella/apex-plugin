#!/usr/bin/env node
/** Shared Node implementation for Azure governance discovery and rendering. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";

export const API_ASSIGNMENTS = "2022-06-01";
export const API_DEFINITIONS = "2021-06-01";
export const API_EXEMPTIONS = "2022-07-01-preview";
export const ARM = "https://management.azure.com";
export const DEFAULT_TTL_DAYS = 7;

const BLOCKER_EFFECTS = new Set(["Deny"]);
const AUTO_REMEDIATE_EFFECTS = new Set(["DeployIfNotExists", "Modify"]);
const RELEVANT_EFFECTS = new Set([...BLOCKER_EFFECTS, ...AUTO_REMEDIATE_EFFECTS]);
const DEFENDER_ASSIGNED_BY_VALUES = new Set(["Security Center", "Microsoft Defender for Cloud"]);
const PARALLEL_WORKERS = 8;

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

const tokenCache = { token: null, expiresAt: 0 };

export function compactJson(value) {
  return JSON.stringify(value);
}

export function isoNow(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value, keys = {}) {
  if (Array.isArray(value)) {
    for (const item of value) flattenKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys[key] = true;
      flattenKeys(item, keys);
    }
  }
  return keys;
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}

export function loadGovernanceJson(filePath) {
  let raw = fs.readFileSync(filePath);
  if (String(filePath).endsWith(".gz") || (raw[0] === 0x1f && raw[1] === 0x8b)) raw = gunzipSync(raw);
  const parsed = JSON.parse(raw.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("governance baseline root must be an object");
  }
  return parsed;
}

export function resolvePath(value, dottedPath) {
  let current = value;
  for (const part of dottedPath.split(".")) {
    if (!current || typeof current !== "object" || !(part in current)) throw new Error(dottedPath);
    current = current[part];
  }
  return current;
}

export function completenessSignature(findings) {
  const tuples = [];
  for (const finding of findings) {
    const tuple = {
      policy_id: finding.policy_id ?? "",
      effect: finding.effect ?? "",
      scope: finding.scope ?? "",
      params: finding.assignment_parameters ?? {},
    };
    for (const key of ["assignment_id", "policy_definition_reference_id"]) {
      if (Object.hasOwn(finding, key)) tuple[key] = finding[key];
    }
    tuples.push(tuple);
  }
  tuples.sort((left, right) => {
    const policyCompare = compareText(left.policy_id, right.policy_id);
    if (policyCompare !== 0) return policyCompare;
    return compareText(stableJson(left), stableJson(right));
  });
  const serialized = tuples.map((tuple) => JSON.stringify(sortValue(tuple))).join("\n");
  return `sha256:${crypto.createHash("sha256").update(serialized, "utf8").digest("hex")}`;
}

export function extractManagementGroups(keptAssignments) {
  const seen = new Set();
  for (const assignment of keptAssignments) {
    const scope = String(assignment.properties?.scope ?? "").toLowerCase();
    const marker = "/providers/microsoft.management/managementgroups/";
    if (!scope.includes(marker)) continue;
    const mg = scope.split(marker, 2)[1].split("/", 1)[0];
    if (mg) seen.add(mg);
  }
  return [...seen];
}

export function buildDiscoveryMetadata({
  findings,
  subscriptionId,
  managementGroups,
  pageCounts,
  discoveredAt,
  discoveryStatus = "COMPLETE",
  ttlDays = DEFAULT_TTL_DAYS,
  apiVersions,
}) {
  return {
    discovery_status: discoveryStatus,
    discovered_at: discoveredAt,
    scope: {
      subscription_id: subscriptionId,
      management_groups: [...managementGroups],
    },
    api_versions: {
      ...(apiVersions ?? {
        policyAssignments: API_ASSIGNMENTS,
        policyDefinitions: API_DEFINITIONS,
        policyExemptions: API_EXEMPTIONS,
      }),
    },
    page_counts: { ...pageCounts },
    completeness_signature: completenessSignature(findings),
    ttl_days: ttlDays,
  };
}

export function extractArchResources(archPath) {
  if (!archPath || !fs.existsSync(archPath)) return [];
  const text = fs.readFileSync(archPath, "utf8");
  const typeMatches = [...text.matchAll(/Microsoft\.\w+\/\w+(?:\/\w+)?/g)].map((match) => match[0]);
  const nameMatches = [...text.matchAll(/(?:vm|sql|vnet|kv|st|app|pip|lb|nsg|nic|pe|natgw|log|acr|aks)-[\w-]+/gi)].map(
    (match) => match[0],
  );
  const resources = [...new Set(typeMatches)].sort().map((armType) => ({
    arm_type: armType,
    name: armType.split("/").at(-1),
  }));
  for (const name of [...new Set(nameMatches)].sort()) {
    if (!resources.some((resource) => resource.name === name)) resources.push({ arm_type: "", name });
  }
  return resources;
}

function inferProjectFromPath(outPath) {
  const parts = path.resolve(outPath).split(path.sep);
  const index = parts.lastIndexOf("agent-output");
  return index >= 0 && parts[index + 1] ? parts[index + 1] : "unknown";
}

function splitTags(tagsRequired) {
  const resolved = [];
  const unresolved = [];
  for (const tag of tagsRequired) {
    const name = tag.name ?? "";
    if (tag.unresolved || name.startsWith("[unresolved")) {
      const params = tag.assignment_parameters ?? {};
      const tagParams = Object.entries(params).filter(
        ([key, value]) => key.startsWith("tagName") && typeof value === "string",
      );
      if (tagParams.length) {
        for (const [, tagName] of tagParams.sort(([left], [right]) => compareText(left, right))) {
          resolved.push({ ...tag, name: tagName });
        }
      } else {
        unresolved.push(tag);
      }
    } else {
      resolved.push(tag);
    }
  }
  return [resolved, unresolved];
}

function extractConstraintValue(finding) {
  const requiredValue = finding.required_value;
  if (requiredValue !== undefined && requiredValue !== null && requiredValue !== "") {
    if (typeof requiredValue === "boolean") return String(requiredValue).toLowerCase();
    if (Array.isArray(requiredValue)) return requiredValue.slice(0, 20).map(String).join(", ");
    return String(requiredValue);
  }
  for (const [name, value] of Object.entries(finding.assignment_parameters ?? {})) {
    if (name.toLowerCase().endsWith("effect")) continue;
    if (Array.isArray(value) && value.length) {
      const suffix = value.length > 20 ? ` … +${value.length - 20} more` : "";
      return `${value.slice(0, 20).map(String).join(", ")}${suffix}`;
    }
    if (["string", "number", "boolean"].includes(typeof value) && value !== "") return String(value);
  }
  return null;
}

function dedupBlockers(blockers) {
  const groups = new Map();
  for (const blocker of blockers) {
    const key = blocker.display_name ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(blocker);
  }
  const deduped = [];
  for (const items of groups.values()) {
    const representative = { ...items[0], _scopes: items.map((item) => item.scope ?? "") };
    const merged = {};
    for (const item of items) {
      for (const [key, value] of Object.entries(item.assignment_parameters ?? {})) {
        if (!Object.hasOwn(merged, key) && value !== null && value !== undefined && value !== "") merged[key] = value;
      }
    }
    if (Object.keys(merged).length) representative.assignment_parameters = merged;
    deduped.push(representative);
  }
  return deduped;
}

export function emitPreviewMd(envelope, outPath, { archResources = null } = {}) {
  const previewPath = outPath.replace(/\.json$/i, ".preview.md");
  const project = envelope.project || inferProjectFromPath(outPath);
  const summary = envelope.discovery_summary ?? {};
  let findings = envelope.findings ?? [];
  const tagsRequired = envelope.tags_required ?? [];
  const discoveredAt = envelope.discovered_at ?? "";
  const hasArch = Array.isArray(archResources) && archResources.length > 0;

  for (const finding of findings) {
    if (finding.azurePropertyPath === null || finding.azurePropertyPath === undefined) finding.azurePropertyPath = "";
    if (finding.bicepPropertyPath === null || finding.bicepPropertyPath === undefined) finding.bicepPropertyPath = "";
  }

  const seenKeys = new Set();
  findings = findings.filter((finding) => {
    const key = JSON.stringify([finding.display_name ?? "", finding.scope ?? "", finding.policy_id ?? ""]);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  const blockers = findings.filter((finding) => finding.classification === "blocker");
  const byCategory = {};
  for (const finding of findings) {
    const category = (finding.category || "Uncategorized").trim();
    byCategory[category] ??= [];
    byCategory[category].push(finding);
  }

  const securityKeywords = ["SFI-", "Safe Secrets", "Key Vault", "Purge Protection", "TLS", "HTTPS", "SSL"];
  const security = [...(byCategory.Security ?? [])];
  for (const finding of findings) {
    if (
      !security.includes(finding) &&
      securityKeywords.some((keyword) => String(finding.display_name ?? "").includes(keyword))
    ) {
      security.push(finding);
    }
  }

  const lines = [];
  const a = (line = "") => lines.push(line);

  a(`# 🛡️ Governance Constraints - ${project}\n`);
  a("![Step](https://img.shields.io/badge/Step-3.5-blue?style=for-the-badge)");
  a("![Status](https://img.shields.io/badge/Status-Discovered-green?style=for-the-badge)");
  a("![Agent](https://img.shields.io/badge/Agent-04g--Governance-purple?style=for-the-badge)\n");
  a("<details open>");
  a("<summary><strong>📑 Governance Contents</strong></summary>\n");
  a("- [🔍 Discovery Source](#-discovery-source)");
  a("- [📋 Azure Policy Compliance](#-azure-policy-compliance)");
  a("- [🔄 Plan Adaptations Based on Policies](#-plan-adaptations-based-on-policies)");
  a("- [🚫 Deployment Blockers](#-deployment-blockers)");
  a("- [🏷️ Required Tags](#-required-tags)");
  a("- [🔐 Security Policies](#-security-policies)");
  a("- [💰 Cost Policies](#-cost-policies)");
  a("- [🌐 Network Policies](#-network-policies)");
  a("- [📜 Compliance Frameworks](#-compliance-frameworks)");
  a("- [References](#references)\n");
  a("</details>\n");
  a(`> Generated by 04g-Governance agent | ${discoveredAt}\n`);
  a("| ⬅️ Previous | 📑 Index | Next ➡️ |");
  a("| --- | --- | --- |");
  a(
    "| [02-architecture-assessment.md](02-architecture-assessment.md) | [README](README.md) | [04-implementation-plan.md](04-implementation-plan.md) |\n",
  );

  a("## 🔍 Discovery Source\n");
  a("| Query | Results | Timestamp |");
  a("| --- | --- | --- |");
  a(`| Policy Assignments | ${summary.assignment_kept ?? 0} policies discovered | ${discoveredAt} |`);
  a(`| Tag Policies | ${tagsRequired.length} tags required | ${discoveredAt} |`);
  a(`| Security Policies | ${security.length} constraints | ${discoveredAt} |\n`);
  const isCached = envelope.source === "cached_baseline" || envelope.cached_baseline === true;
  const method = isCached
    ? "Cached governance baseline (governance-policy-baseline.json.gz)"
    : "Azure Policy REST API (discover.py)";
  a(`**Discovery Method**: ${method}`);
  a(`**Subscription**: ${envelope.subscription_id ?? "unknown"}`);
  a("**Scope**: Subscription + management-group inherited\n");
  if (blockers.length) {
    a(
      `> ⚠️ **${blockers.length} deployment blocker(s)** detected. Review the [Deployment Blockers](#-deployment-blockers) section before proceeding to IaC planning.\n`,
    );
  }

  a("### Policy Definition Analysis\n");
  a(
    "| Policy Display Name | Assignment Scope | Effect | Classification | Category | Bicep Property Path | Required Value |",
  );
  a("| --- | --- | --- | --- | --- | --- | --- |");
  for (const finding of findings) {
    let bpp = finding.bicepPropertyPath ?? "";
    if (bpp === "type") bpp = "type (resource-type constraint)";
    a(
      `| ${finding.display_name ?? ""} | ${finding.scope ?? ""} | ${finding.effect ?? ""} | ${finding.classification ?? ""} | ${finding.category ?? ""} | ${bpp} | ${extractConstraintValue(finding) ?? ""} |`,
    );
  }
  a("");

  a("## 📋 Azure Policy Compliance\n");
  if (!hasArch)
    a(
      "> **Note**: No architecture assessment provided. IaC impact annotations will be populated during Step 4 (IaC Planning).\n",
    );
  a("| Category | Constraint | Implementation | Status |");
  a("| --- | --- | --- | --- |");
  for (const [category, items] of Object.entries(byCategory).sort(([left], [right]) => compareText(left, right))) {
    for (const finding of items) {
      const classification = finding.classification ?? "";
      const statusIcon = classification === "blocker" ? "❌" : classification === "auto-remediate" ? "✅" : "⚠️";
      const implementation = hasArch
        ? "See JSON findings[] for structured value."
        : classification === "blocker"
          ? "Blocked — must comply before deployment"
          : classification === "auto-remediate"
            ? "Auto-applied by Azure Policy"
            : "Audit only — no enforcement";
      a(`| ${category} | ${finding.display_name ?? ""} | ${implementation} | ${statusIcon} |`);
    }
  }
  a("");

  a("## 🔄 Plan Adaptations Based on Policies\n");
  a("### Architectural Changes\n");
  if (blockers.length && hasArch) {
    a("| Original Design | Blocking Policy | Effect | Target Resource Types | Adaptation Applied |");
    a("| --- | --- | --- | --- | --- |");
    for (const finding of blockers) {
      const types = new Set(finding.resource_types ?? []);
      const matched = archResources.filter((resource) => types.has(resource.arm_type ?? ""));
      const note = "Deny effect — Step 4 must map to an explicit IaC control or document an exception.";
      if (matched.length) {
        for (const resource of matched) {
          a(
            `| ${resource.name ?? ""} (${resource.arm_type ?? ""}) | ${finding.display_name ?? ""} | ${finding.effect ?? ""} | ${[...types].join(", ")} | ${note} |`,
          );
        }
      } else {
        a(
          `| Cross-check against architecture resource map (Step 4 input). | ${finding.display_name ?? ""} | ${finding.effect ?? ""} | ${[...types].join(", ")} | ${note} |`,
        );
      }
    }
  } else if (blockers.length) {
    a("| Original Design | Blocking Policy | Effect | Adaptation Applied |");
    a("| --- | --- | --- | --- |");
    for (const finding of blockers) {
      a(
        `| No architecture target | ${finding.display_name ?? ""} | ${finding.effect ?? ""} | Review at Step 4 IaC Planning |`,
      );
    }
  } else {
    a("✅ Original architecture complies with all discovered policies.\n");
  }
  a("");

  a("### Auto-Applied Resources\n");
  const dineFindings = findings.filter((finding) => finding.effect === "deployIfNotExists");
  if (dineFindings.length) {
    a("| Policy | Effect | Auto-Applied Resource |");
    a("| --- | --- | --- |");
    for (const finding of dineFindings)
      a(`| ${finding.display_name ?? ""} | DeployIfNotExists | Auto-deployed by Azure Policy |`);
  } else {
    a("✅ No additional resources will be auto-deployed.\n");
  }
  a("");

  a("### Auto-Modified Configurations\n");
  const modifyFindings = findings.filter((finding) => finding.effect === "modify");
  if (modifyFindings.length) {
    a("| Policy | Effect | Auto-Applied Change |");
    a("| --- | --- | --- |");
    for (const finding of modifyFindings)
      a(`| ${finding.display_name ?? ""} | Modify | Auto-modified by Azure Policy |`);
  } else {
    a("✅ No auto-modifications expected.\n");
  }
  a("");

  a("## 🚫 Deployment Blockers\n");
  if (!blockers.length) {
    a("✅ No deployment blockers detected.\n");
  } else {
    const deduped = dedupBlockers(blockers);
    a(
      `> **${blockers.length}** blocker finding(s) from **${deduped.length}** unique policies (duplicates from multi-scope inheritance are consolidated below).\n`,
    );
    for (const finding of deduped) {
      a(`### ${finding.display_name ?? "Unknown Policy"}\n`);
      a(`- **Policy ID**: \`${finding.policy_id ?? ""}\``);
      a(`- **Effect**: ${finding.effect ?? ""}`);
      const scopes = finding._scopes ?? [finding.scope ?? ""];
      if (scopes.length > 1) {
        a(`- **Scopes** (${scopes.length} assignments):`);
        for (const scope of scopes) a(`  - \`${scope}\``);
      } else {
        a(`- **Scope**: ${scopes[0]}`);
      }
      a(`- **Category**: ${finding.category ?? ""}`);
      let bpp = finding.bicepPropertyPath ?? "";
      if (bpp === "type") bpp = "type (resource-type constraint — enforced at type level, not a specific property)";
      a(`- **Bicep Property Path**: \`${bpp}\``);
      a(
        `- **Required Value**: ${extractConstraintValue(finding) ?? "N/A — parameter values not available in cached baseline; run `--refresh` for live lookup"}`,
      );
      a("");
      a(
        "> **Resolution**: Review during Step 4 IaC Planning — apply an exemption, use an allowed alternative, or update the policy scope.\n",
      );
    }
  }
  a("");

  a("## 🏷️ Required Tags\n");
  if (tagsRequired.length) {
    const findingsByDisplayName = new Map();
    for (const finding of findings) {
      if (finding.display_name && !findingsByDisplayName.has(finding.display_name))
        findingsByDisplayName.set(finding.display_name, finding);
    }
    const enrichedTags = tagsRequired.map((tag) => {
      if (tag.unresolved || String(tag.name ?? "").startsWith("[unresolved")) {
        const matching = findingsByDisplayName.get(tag.source_assignment ?? "");
        if (matching?.assignment_parameters) return { ...tag, assignment_parameters: matching.assignment_parameters };
      }
      return tag;
    });
    const [resolved, unresolved] = splitTags(enrichedTags);
    a("All resources must include the following tags:\n");
    if (unresolved.length)
      a(
        "> **Note**: Some tag names could not be resolved from cached policy data. Run with `--refresh` for full tag resolution.\n",
      );
    a("| Tag Name | Source Policy |");
    a("| --- | --- |");
    for (const tag of resolved) a(`| \`${tag.name}\` | ${tag.source_assignment ?? tag.source_policy ?? ""} |`);
    for (const tag of unresolved)
      a(`| [unresolved] | ${tag.source_assignment ?? tag.source_policy ?? ""} — tag key requires live discovery |`);
  } else {
    a("No tag-enforcement policies discovered.\n");
  }
  a("");
  a("```mermaid");
  a("%%{init: {'theme':'neutral'}}%%");
  a("flowchart TD");
  a('    MG["Management Group Tags"] -->|inherited| SUB["Subscription Tags"]');
  a('    SUB -->|inherited| RG["Resource Group Tags"]');
  a('    RG -->|inherited| RES["Resource Tags"]');
  a('    POL["Azure Policy\\n(Modify effect)"] -->|auto-applies| RES');
  a("    style POL fill:#FFB900,stroke:#333");
  a("    style RES fill:#0078D4,color:#fff,stroke:#333");
  a("```\n");

  a("## 🔐 Security Policies\n");
  if (security.length) {
    a("| Policy | Effect | Status |");
    a("| --- | --- | --- |");
    for (const finding of security) {
      const icon = finding.classification === "blocker" ? "❌" : "✅";
      a(`| ${finding.display_name ?? ""} | ${finding.effect ?? ""} | ${icon} |`);
    }
  } else {
    a("✅ No security-specific policies discovered.\n");
  }
  a("");

  a("## 💰 Cost Policies\n");
  const cost = [...(byCategory.Cost ?? []), ...(byCategory.Budget ?? [])];
  const costKeywords = [
    "Block VM SKU",
    "Block Azure OpenAI Provisioned",
    "Block Azure Sentinel Commitment",
    "Deny AKS deployment with agent pool count",
    "Deny VMSS deployment with instance count",
  ];
  for (const finding of findings) {
    if (!cost.includes(finding) && costKeywords.some((keyword) => String(finding.display_name ?? "").includes(keyword)))
      cost.push(finding);
  }
  if (cost.length) {
    a("| Policy | Effect | Constraint |");
    a("| --- | --- | --- |");
    for (const finding of cost)
      a(
        `| ${finding.display_name ?? ""} | ${finding.effect ?? ""} | ${extractConstraintValue(finding) ?? "See policy parameters"} |`,
      );
  } else {
    a("No cost-specific policies discovered.\n");
  }
  a("");

  a("## 🌐 Network Policies\n");
  const network = [...(byCategory.Network ?? []), ...(byCategory.Networking ?? [])];
  const networkKeywords = ["vNet peering", "virtual network", "subnet", "NSG", "firewall"];
  for (const finding of findings) {
    if (
      !network.includes(finding) &&
      networkKeywords.some((keyword) =>
        String(finding.display_name ?? "")
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      )
    ) {
      network.push(finding);
    }
  }
  if (network.length) {
    a("| Policy | Effect | Constraint |");
    a("| --- | --- | --- |");
    for (const finding of network)
      a(
        `| ${finding.display_name ?? ""} | ${finding.effect ?? ""} | ${extractConstraintValue(finding) ?? "See policy parameters"} |`,
      );
  } else {
    a("No network-specific policies discovered.\n");
  }
  a("");

  a("## 📜 Compliance Frameworks\n");
  const complianceKeywords = [
    "GDPR",
    "PCI DSS",
    "HIPAA",
    "SOC",
    "ISO 27001",
    "NIST",
    "Multi Factor Authentication",
    "MFA",
    "Security Benchmark",
    "Security Baseline",
    "CIS",
  ];
  const findingNames = new Set(findings.map((finding) => finding.display_name ?? ""));
  const notableAssignments = (envelope.assignment_inventory ?? []).filter((assignment) => {
    const displayName = assignment.displayName || assignment.display_name || "";
    return (
      !findingNames.has(displayName) &&
      complianceKeywords.some((keyword) => displayName.toLowerCase().includes(keyword.toLowerCase()))
    );
  });
  if (notableAssignments.length) {
    a("> These audit/compliance assignments are active at subscription or management-group scope. ");
    a("> While they do not block deployments (audit effect), they may impose architecture constraints ");
    a("> (data residency, encryption, access logging, network segmentation).\n");
    a("| Assignment | Scope | Type |");
    a("| --- | --- | --- |");
    for (const assignment of notableAssignments) {
      a(
        `| ${assignment.displayName || assignment.display_name || ""} | ${assignment.scope ?? ""} | ${assignment.assignmentType ?? ""} |`,
      );
    }
    a("");
  } else {
    a(
      "✅ No compliance framework assignments (GDPR, PCI DSS, HIPAA, etc.) discovered at subscription or management-group scope.\n",
    );
  }

  a("## References\n");
  a("| Topic | Link |");
  a("| --- | --- |");
  a("| Azure Policy | [Overview](https://learn.microsoft.com/azure/governance/policy/overview) |");
  a(
    "| Tag Governance | [Tagging Strategy](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-tagging) |\n",
  );
  a("---\n");
  a(
    `_Governance constraints discovered from ${isCached ? "cached governance baseline" : "Azure Policy REST API via discover.py"}._\n`,
  );

  fs.writeFileSync(previewPath, `${lines.join("\n")}\n`);
  return previewPath;
}

function runAz(args, { timeoutMs = 30_000 } = {}) {
  const command = process.platform === "win32" ? "az.cmd" : "az";
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === "win32", windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`az ${args.join(" ")} timed out`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || stdout.trim() || `az exited ${code}`));
    });
  });
}

export async function getDefaultSubscription() {
  return (await runAz(["account", "show", "--query", "id", "-o", "tsv"])).trim();
}

async function getArmToken() {
  const now = Date.now() / 1000;
  if (tokenCache.token && tokenCache.expiresAt > now + 60) return tokenCache.token;
  const out = await runAz(["account", "get-access-token", "--resource", `${ARM}/`, "-o", "json"]);
  const data = JSON.parse(out);
  tokenCache.token = data.accessToken;
  tokenCache.expiresAt = now + 50 * 60;
  return tokenCache.token;
}

export async function defaultAzRest(url) {
  const token = await getArmToken();
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (response.status === 404) return {};
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`ARM GET ${url} failed: HTTP ${response.status} ${response.statusText}; ${detail}`);
  }
  return response.json();
}

export async function checkAuth() {
  await getArmToken();
}

async function listAll(azRest, url) {
  const items = [];
  let nextUrl = url;
  const visited = new Set();
  while (nextUrl) {
    if (typeof nextUrl !== "string" || visited.has(nextUrl)) throw new Error("Invalid or cyclic ARM pagination link");
    visited.add(nextUrl);
    const page = await azRest(nextUrl);
    if (!page || typeof page !== "object" || !Array.isArray(page.value))
      throw new Error(`Missing ARM list value: ${nextUrl}`);
    if (!page.value.every((item) => item && typeof item === "object" && !Array.isArray(item)))
      throw new Error(`Invalid ARM list item: ${nextUrl}`);
    items.push(...page.value);
    nextUrl = page.nextLink;
  }
  return items;
}

async function parallelMap(items, mapper, limit = PARALLEL_WORKERS) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function parallelList(azRest, urls) {
  const entries = Object.entries(urls);
  const values = await parallelMap(
    entries,
    ([, url]) => listAll(azRest, url),
    Math.min(PARALLEL_WORKERS, entries.length),
  );
  return Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
}

async function parallelFetchItems(azRest, urls, expectedIds = null) {
  const expected = expectedIds ?? urls.map(() => "");
  return parallelMap(
    urls,
    async (url, index) => {
      const expectedId = expected[index] ?? "";
      const response = await azRest(url);
      if (!response || typeof response !== "object" || !Object.keys(response).length) return null;
      if (Array.isArray(response.value)) {
        if (expectedId)
          return (
            response.value.find((item) => String(item.id ?? "").toLowerCase() === expectedId.toLowerCase()) ?? null
          );
        return response.value[0] ?? null;
      }
      if (response.id)
        return !expectedId || String(response.id).toLowerCase() === expectedId.toLowerCase() ? response : null;
      return null;
    },
    Math.min(PARALLEL_WORKERS, urls.length),
  );
}

function resolveParameters(value, parameters) {
  if (typeof value === "string") {
    const match = /^\[parameters\('([^']+)'\)\]$/i.exec(value.trim());
    if (match) {
      const found = Object.entries(parameters).find(([key]) => key.toLowerCase() === match[1].toLowerCase());
      return found ? found[1] : value;
    }
  }
  if (Array.isArray(value)) return value.map((item) => resolveParameters(item, parameters));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveParameters(item, parameters)]));
  }
  return value;
}

function effectiveParameters(definition, supplied) {
  const defaults = definition.properties?.parameters ?? {};
  const names = Object.fromEntries(Object.keys(defaults).map((key) => [key.toLowerCase(), key]));
  const result = {};
  for (const [key, item] of Object.entries(defaults)) {
    if (item && typeof item === "object" && Object.hasOwn(item, "defaultValue")) result[key] = item.defaultValue;
  }
  for (const [key, item] of Object.entries(supplied ?? {})) {
    if (item && typeof item === "object" && Object.hasOwn(item, "value"))
      result[names[key.toLowerCase()] ?? key] = item.value;
  }
  return result;
}

function effectiveDefinition(definition, parameters) {
  const resolved = clone(definition);
  resolved.properties ??= {};
  resolved.properties.policyRule = resolveParameters(resolved.properties.policyRule ?? {}, parameters);
  const normalized = Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key.toLowerCase(), value]));
  for (const [key, item] of Object.entries(resolved.properties.parameters ?? {})) {
    if (key.toLowerCase() in normalized) item.defaultValue = normalized[key.toLowerCase()];
  }
  return resolved;
}

function effectOf(definition) {
  const effect = definition.properties?.policyRule?.then?.effect;
  if (typeof effect !== "string") return null;
  return (
    {
      deny: "Deny",
      audit: "Audit",
      auditifnotexists: "AuditIfNotExists",
      deployifnotexists: "DeployIfNotExists",
      modify: "Modify",
      append: "Append",
      disabled: "Disabled",
    }[effect.toLowerCase()] ?? effect
  );
}

function resourceTypes(definition) {
  const types = new Set();
  const stack = [definition.properties?.policyRule?.if];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === "object") {
      if (node.field === "type" && typeof node.equals === "string") types.add(node.equals);
      stack.push(...Object.values(node));
    }
  }
  return [...types].sort();
}

function requiredValue(definition) {
  const props = definition.properties ?? {};
  const details = props.policyRule?.then?.details ?? {};
  if (Object.hasOwn(details, "value")) return details.value;
  const operations = details.operations ?? [];
  if (Array.isArray(operations) && operations.length === 1 && Object.hasOwn(operations[0] ?? {}, "value"))
    return operations[0].value;
  for (const [name, item] of Object.entries(props.parameters ?? {})) {
    const defaultValue = item?.defaultValue;
    if (
      defaultValue !== undefined &&
      [
        "allowedlocations",
        "listofallowedlocations",
        "allowedskus",
        "listofallowedskus",
        "tagname",
        "tagvalue",
        "minimumtlsversion",
        "requiredretentiondays",
      ].includes(name.toLowerCase())
    ) {
      return defaultValue;
    }
  }
  return null;
}

function looksLikeTagPolicy(rule) {
  const stack = [rule.if];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === "object") {
      if (typeof node.field === "string" && node.field.toLowerCase().startsWith("tags[")) return true;
      stack.push(...Object.values(node));
    }
  }
  return false;
}

function propertyPaths(definition, rtypes) {
  const rule = definition.properties?.policyRule ?? {};
  const operations = rule.then?.details?.operations;
  const operationFields = [];
  if (operations !== undefined) {
    if (!Array.isArray(operations) || !operations.length) return { azurePropertyPath: "", bicepPropertyPath: "" };
    for (const operation of operations) {
      const field = operation && typeof operation === "object" ? operation.field : null;
      if (typeof field !== "string" || !field) return { azurePropertyPath: "", bicepPropertyPath: "" };
      if (!operationFields.includes(field)) operationFields.push(field);
    }
    if (operationFields.length !== 1) return { azurePropertyPath: "", bicepPropertyPath: "" };
  }
  const tagOperation = operationFields.length && operationFields[0].toLowerCase().startsWith("tags[");
  if (tagOperation || (!operationFields.length && !rtypes.length && looksLikeTagPolicy(rule))) {
    return {
      azurePropertyPath: "resourceGroup.tags",
      bicepPropertyPath: "resourceGroups::tags",
      pathSemantics: "tag-policy-non-property",
    };
  }
  if (!rtypes.length) return { azurePropertyPath: "", bicepPropertyPath: "" };
  let primaryType = rtypes[0];
  if (operationFields.length) {
    const matches = rtypes.filter((kind) => operationFields[0].toLowerCase().startsWith(`${kind.toLowerCase()}/`));
    if (!matches.length) return { azurePropertyPath: "", bicepPropertyPath: "" };
    primaryType = matches.sort((left, right) => right.length - left.length)[0];
  }
  let candidateFields = [];
  const stack = [rule.if];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === "object") {
      if (typeof node.field === "string" && node.field.startsWith(`${primaryType}/`)) candidateFields.push(node.field);
      stack.push(...Object.values(node));
    }
  }
  if (operationFields.length) candidateFields = [`${primaryType}/${operationFields[0].slice(primaryType.length + 1)}`];
  if (!candidateFields.length) {
    if (!operationFields.length && looksLikeTagPolicy(rule)) {
      return {
        azurePropertyPath: "resourceGroup.tags",
        bicepPropertyPath: "resourceGroups::tags",
        pathSemantics: "tag-policy-non-property",
      };
    }
    return { azurePropertyPath: "", bicepPropertyPath: "" };
  }
  const prefix = `${primaryType}/`;
  const scored = candidateFields
    .map((field) => [field.startsWith(prefix) ? field.slice(prefix.length) : field.split("/").at(-1), field])
    .filter(([tail]) => tail)
    .sort(([left], [right]) => right.split("/").length - left.split("/").length);
  if (!scored.length) return { azurePropertyPath: "", bicepPropertyPath: "" };
  const propertyPath = scored[0][0];
  const providerType = primaryType.split("/").slice(1).join("/");
  const camelType = providerType.slice(0, 1).toLowerCase() + providerType.slice(1);
  return {
    azurePropertyPath: `${camelType}.${propertyPath}`,
    bicepPropertyPath: `${BICEP_TYPE_OVERRIDES[primaryType] ?? camelType}::${propertyPath}`,
  };
}

function extractPolicyRuleTagKeys(definition) {
  const keys = [];
  const seen = new Set();
  const stack = [definition.properties?.policyRule?.if];
  const tagField = /^tags\[(?:'|")?([^'"\]]+)(?:'|")?\]$/i;
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node && typeof node === "object") {
      if (typeof node.field === "string") {
        const match = tagField.exec(node.field.trim());
        if (match && match[1].trim() && !seen.has(match[1].trim())) {
          seen.add(match[1].trim());
          keys.push(match[1].trim());
        }
      }
      stack.push(...Object.values(node));
    }
  }
  return keys;
}

function isDefenderAuto(assignment) {
  const metadata = assignment.properties?.metadata ?? {};
  if (typeof metadata.assignedBy === "string" && DEFENDER_ASSIGNED_BY_VALUES.has(metadata.assignedBy.trim()))
    return true;
  if (
    metadata.createdBy &&
    typeof metadata.createdBy === "object" &&
    DEFENDER_ASSIGNED_BY_VALUES.has(String(metadata.createdBy.displayName ?? "").trim())
  )
    return true;
  return false;
}

function buildExemptionMap(exemptions) {
  const out = new Map();
  for (const exemption of exemptions) {
    const props = exemption.properties ?? {};
    const assignmentId = String(props.policyAssignmentId ?? "").toLowerCase();
    if (!assignmentId) continue;
    const exemptionId = exemption.id ?? "";
    const scope = exemptionId.toLowerCase().split("/providers/microsoft.authorization/policyexemptions/")[0];
    if (!out.has(assignmentId)) out.set(assignmentId, []);
    out.get(assignmentId).push({
      id: exemptionId,
      scope,
      exemptionCategory: props.exemptionCategory,
      expiresOn: props.expiresOn ?? null,
      description: props.description ?? null,
      policyDefinitionReferenceIds: props.policyDefinitionReferenceIds ?? [],
      resourceSelectors: props.resourceSelectors ?? [],
    });
  }
  for (const candidates of out.values())
    candidates.sort((left, right) => compareText(stableJson(left), stableJson(right)));
  return out;
}

function parseAzureDate(value) {
  if (typeof value !== "string") return null;
  const normalized = value.endsWith("Z") ? value : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  if (!/[zZ]|[+-]\d\d:\d\d$/.test(value)) return null;
  return parsed;
}

function coveringExemption(candidates, subscriptionId, assignmentScope, memberRefId, now) {
  const targetScope = `/subscriptions/${subscriptionId}`.toLowerCase();
  for (const candidate of candidates) {
    if (!["Waiver", "Mitigated"].includes(candidate.exemptionCategory) || candidate.resourceSelectors?.length) continue;
    const scope = String(candidate.scope ?? "").replace(/\/+$/, "");
    if (
      scope !== targetScope &&
      !(
        scope ===
          String(assignmentScope ?? "")
            .toLowerCase()
            .replace(/\/+$/, "") && /^\/providers\/microsoft\.management\/managementgroups\/[^/]+$/.test(scope)
      )
    ) {
      continue;
    }
    const refIds = candidate.policyDefinitionReferenceIds ?? [];
    if (refIds.length && !refIds.includes(memberRefId)) continue;
    if (candidate.expiresOn !== null && candidate.expiresOn !== undefined) {
      const expiresAt = parseAzureDate(candidate.expiresOn);
      if (!expiresAt || expiresAt <= now) continue;
    }
    return candidate;
  }
  return null;
}

function extractTagsRequired(findings) {
  const seen = new Set();
  const tags = [];
  for (const finding of findings) {
    if (!(
      finding.pathSemantics === "tag-policy-non-property" || String(finding.category ?? "").toLowerCase() === "tags"
    ))
      continue;
    const params = finding.assignment_parameters ?? {};
    const tagKeys = [];
    for (const key of finding.extracted_tag_keys ?? []) if (typeof key === "string" && key) tagKeys.push(key);
    for (const name of ["tagName", "tagname", "tag_name"]) {
      const value = params[name];
      if (typeof value === "string" && value) tagKeys.push(value);
      else if (Array.isArray(value)) tagKeys.push(...value.filter(Boolean).map(String));
    }
    for (const name of ["tagNames", "listOfTagNames", "tagnames"]) {
      const value = params[name];
      if (Array.isArray(value)) tagKeys.push(...value.filter(Boolean).map(String));
    }
    const source = finding.policy_id ?? "";
    const policyName = String(finding.display_name ?? "").trim();
    if (tagKeys.length) {
      for (const key of tagKeys) {
        const trimmed = key.trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          tags.push({
            name: trimmed,
            source_policy: source,
            source_assignment: finding.assignment_display_name ?? "",
          });
        }
      }
    } else if (policyName && !seen.has(policyName)) {
      seen.add(policyName);
      tags.push({
        name: `[unresolved: ${policyName}]`,
        source_policy: source,
        source_assignment: finding.assignment_display_name ?? "",
        unresolved: "true",
      });
    }
  }
  return tags;
}

function hasLocationCondition(condition) {
  if (Array.isArray(condition)) return condition.some(hasLocationCondition);
  if (condition && typeof condition === "object") {
    return (
      String(condition.field ?? "").toLowerCase() === "location" || Object.values(condition).some(hasLocationCondition)
    );
  }
  return false;
}

function locationConstraint(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return [null, false];
  if (condition.field === "location" && Array.isArray(condition.notIn)) {
    const values = condition.notIn;
    if (values.every((value) => typeof value === "string" && value && !value.startsWith("[")))
      return [[...new Set(values.map((value) => value.toLowerCase()))].sort(), true];
  }
  if (Object.keys(condition).length === 1 && Object.hasOwn(condition, "not")) {
    const inner = condition.not;
    if (
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      Object.keys(inner).sort().join(",") === "field,in"
    ) {
      return locationConstraint({ field: inner.field, notIn: inner.in });
    }
  }
  if (Object.keys(condition).length === 1 && Array.isArray(condition.allOf)) {
    const constraints = [];
    let universal = true;
    for (const child of condition.allOf) {
      const [locations, appliesGlobally] = locationConstraint(child);
      if (locations !== null) constraints.push(new Set(locations));
      else if (
        stableJson(child) !== stableJson({ field: "location", notEquals: "global" }) &&
        stableJson(child) !== stableJson({ field: "type", notEquals: "Microsoft.Resources/deployments" })
      ) {
        universal = false;
      }
      if (locations !== null && !appliesGlobally) universal = false;
    }
    if (constraints.length) return [[...new Set(constraints.flatMap((set) => [...set]))].sort(), universal];
  }
  return [null, false];
}

function extractAllowedLocations(findings) {
  if (
    findings.some(
      (finding) =>
        "location_constraint_global" in finding &&
        !finding.location_constraint_global &&
        finding.classification === "blocker",
    )
  )
    return [];
  const constraints = findings
    .filter((finding) => finding.location_constraint_global && finding.classification === "blocker")
    .map((finding) => new Set(finding.required_value));
  if (!constraints.length) return [];
  return [...constraints.reduce((acc, set) => new Set([...acc].filter((value) => set.has(value))))].sort();
}

function classify(effect) {
  if (BLOCKER_EFFECTS.has(effect)) return "blocker";
  if (AUTO_REMEDIATE_EFFECTS.has(effect)) return "auto-remediate";
  return "informational";
}

async function selfCheckAssignments(azRest, subscriptionId, expectedCount, expectedAssignments = null) {
  try {
    const url = `${ARM}/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyAssignments?$filter=atScope()&api-version=${API_ASSIGNMENTS}`;
    const items = await listAll(azRest, url);
    const sameInventory =
      !expectedAssignments ||
      JSON.stringify(items.map(stableJson).sort()) === JSON.stringify(expectedAssignments.map(stableJson).sort());
    return [items.length === expectedCount && sameInventory, items.length];
  } catch {
    return [false, -1];
  }
}

export async function discover(
  subscriptionId,
  { project, includeDefenderAuto = false, azRest = defaultAzRest, verbose = false, now = new Date() } = {},
) {
  const base = `${ARM}/subscriptions/${subscriptionId}/providers/Microsoft.Authorization`;
  const primary = await parallelList(azRest, {
    assignments: `${base}/policyAssignments?$filter=atScope()&api-version=${API_ASSIGNMENTS}`,
    sub_defs: `${base}/policyDefinitions?api-version=${API_DEFINITIONS}`,
    sub_sets: `${base}/policySetDefinitions?api-version=${API_DEFINITIONS}`,
    exemptions: `${base}/policyExemptions?$filter=atScope()&api-version=${API_EXEMPTIONS}`,
  });
  const assignments = primary.assignments;
  const defs = new Map(primary.sub_defs.map((definition) => [String(definition.id).toLowerCase(), definition]));
  const sets = new Map(primary.sub_sets.map((policySet) => [String(policySet.id).toLowerCase(), policySet]));
  const exemptions = primary.exemptions;

  const tenantSetIds = new Map();
  const tenantDefIds = new Map();
  for (const assignment of assignments) {
    const originalId = assignment.properties?.policyDefinitionId ?? "";
    const lowerId = originalId.toLowerCase();
    if (!lowerId) continue;
    if (lowerId.includes("/policysetdefinitions/") && !sets.has(lowerId)) tenantSetIds.set(lowerId, originalId);
    else if (lowerId.includes("/policydefinitions/") && !defs.has(lowerId)) tenantDefIds.set(lowerId, originalId);
  }

  if (tenantSetIds.size) {
    const ordered = [...tenantSetIds.entries()].sort(([left], [right]) => compareText(left, right));
    const fetched = await parallelFetchItems(
      azRest,
      ordered.map(([, original]) => `${ARM}${original}?api-version=${API_DEFINITIONS}`),
      ordered.map(([, original]) => original),
    );
    for (const policySet of fetched) if (policySet) sets.set(String(policySet.id ?? "").toLowerCase(), policySet);
  }

  for (const policySet of sets.values()) {
    for (const member of policySet.properties?.policyDefinitions ?? []) {
      const memberId = member.policyDefinitionId ?? "";
      if (memberId && !defs.has(memberId.toLowerCase())) tenantDefIds.set(memberId.toLowerCase(), memberId);
    }
  }

  if (tenantDefIds.size) {
    const ordered = [...tenantDefIds.entries()].sort(([left], [right]) => compareText(left, right));
    const fetched = await parallelFetchItems(
      azRest,
      ordered.map(([, original]) => `${ARM}${original}?api-version=${API_DEFINITIONS}`),
      ordered.map(([, original]) => original),
    );
    for (const definition of fetched) if (definition) defs.set(String(definition.id ?? "").toLowerCase(), definition);
  }

  const exemptionMap = buildExemptionMap(exemptions);
  const filteredDefender = [];
  const keptAssignments = [];
  for (const assignment of assignments) {
    if (isDefenderAuto(assignment) && !includeDefenderAuto) {
      filteredDefender.push(assignment.properties?.displayName || assignment.name || assignment.id || "<unknown>");
    } else {
      keptAssignments.push(assignment);
    }
  }
  if (verbose) for (const name of filteredDefender) console.error(`filter: skipping Defender auto-assignment: ${name}`);

  const assignmentInventory = [];
  const findings = [];
  let auditCount = 0;
  let disabledCount = 0;
  const unresolved = [];

  for (const assignment of keptAssignments) {
    const props = assignment.properties ?? {};
    const display = props.displayName || assignment.name || assignment.id || "<unknown>";
    const scope = props.scope || "";
    const policyId = String(props.policyDefinitionId ?? "").toLowerCase();
    const assignmentId = String(assignment.id ?? "").toLowerCase();
    const assignmentType = scope.toLowerCase().includes("/providers/microsoft.management/managementgroups/")
      ? "management-group"
      : "subscription";
    assignmentInventory.push({ displayName: display, scope, assignmentType, policyDefinitionId: policyId });
    if (!policyId) {
      unresolved.push(assignmentId);
      continue;
    }
    const members = [];
    if (policyId.includes("/policysetdefinitions/") && sets.has(policyId)) {
      const setParameters = effectiveParameters(sets.get(policyId), props.parameters ?? {});
      const setMembers = sets.get(policyId).properties?.policyDefinitions ?? [];
      if (!setMembers.length) unresolved.push(policyId);
      for (const member of setMembers) {
        const memberId = String(member.policyDefinitionId ?? "").toLowerCase();
        if (defs.has(memberId))
          members.push([
            defs.get(memberId),
            member.policyDefinitionReferenceId,
            resolveParameters(member.parameters ?? {}, setParameters),
          ]);
        else unresolved.push(memberId || policyId);
      }
    } else if (defs.has(policyId)) {
      members.push([defs.get(policyId), null, props.parameters ?? {}]);
    } else {
      unresolved.push(policyId);
    }

    for (const [originalDefinition, memberRefId, supplied] of members) {
      const effective = effectiveParameters(originalDefinition, supplied);
      const definition = effectiveDefinition(originalDefinition, effective);
      const effect = effectOf(definition);
      if (effect === null) {
        unresolved.push(originalDefinition.id || policyId);
        continue;
      }
      if (effect === "Disabled") {
        disabledCount += 1;
        continue;
      }
      if (effect === "Audit" || effect === "AuditIfNotExists") {
        auditCount += 1;
        continue;
      }
      if (!RELEVANT_EFFECTS.has(effect)) {
        if (effect !== "Append") unresolved.push(originalDefinition.id || policyId);
        continue;
      }

      const rtypes = resourceTypes(definition);
      const paths = propertyPaths(definition, rtypes);
      const category = definition.properties?.metadata?.category ?? "Uncategorized";
      const candidates = exemptionMap.get(assignmentId) ?? [];
      const exemption = coveringExemption(candidates, subscriptionId, scope, memberRefId, now);
      let classification = classify(effect);
      if (exemption !== null && classification === "blocker") classification = "informational";
      if (props.enforcementMode === "DoNotEnforce") classification = "informational";
      const finding = {
        policy_id: definition.id,
        display_name: definition.properties?.displayName || definition.name || definition.id,
        effect: effect.slice(0, 1).toLowerCase() + effect.slice(1),
        scope,
        assignment_display_name: display,
        assignment_id: assignment.id,
        policy_definition_reference_id: memberRefId,
        not_scopes: props.notScopes ?? [],
        resource_selectors: props.resourceSelectors ?? [],
        enforcement_mode: props.enforcementMode ?? "Default",
        classification,
        category,
        resource_types: rtypes,
        required_value: requiredValue(definition),
        azurePropertyPath: paths.azurePropertyPath,
        bicepPropertyPath: paths.bicepPropertyPath,
        exemption,
        override: null,
      };
      if (candidates.length) finding.exemption_candidates = candidates;
      const condition = definition.properties?.policyRule?.if;
      const [locations, universal] = locationConstraint(condition);
      if (locations !== null || hasLocationCondition(condition)) {
        if (locations !== null) finding.required_value = locations;
        finding.location_condition = condition;
        finding.location_constraint_global = Boolean(
          universal &&
          !rtypes.length &&
          !finding.not_scopes.length &&
          !finding.resource_selectors.length &&
          (scope.toLowerCase().replace(/\/+$/, "") === `/subscriptions/${subscriptionId}`.toLowerCase() ||
            /^\/providers\/microsoft\.management\/managementgroups\/[^/]+$/.test(scope.toLowerCase())),
        );
      }
      if (Object.keys(effective).length) finding.assignment_parameters = effective;
      if (paths.pathSemantics) finding.pathSemantics = paths.pathSemantics;
      if (
        finding.pathSemantics === "tag-policy-non-property" ||
        String(finding.category ?? "").toLowerCase() === "tags"
      ) {
        const ruleTagKeys = extractPolicyRuleTagKeys(definition);
        if (ruleTagKeys.length) finding.extracted_tag_keys = ruleTagKeys;
      }
      findings.push(finding);
    }
  }

  const blockers = findings.filter((finding) => finding.classification === "blocker").length;
  const autoRemediate = findings.filter((finding) => finding.classification === "auto-remediate").length;
  const exempted = findings.filter((finding) => finding.exemption !== null && finding.exemption !== undefined).length;
  let discoveryStatus = unresolved.length ? "PARTIAL" : "COMPLETE";
  for (const id of [...new Set(unresolved)].sort()) console.error(`unresolved policy definition or effect: ${id}`);
  const [selfCheckOk, selfCheckCount] = await selfCheckAssignments(
    azRest,
    subscriptionId,
    assignments.length,
    assignments,
  );
  if (!selfCheckOk) {
    discoveryStatus = "PARTIAL";
    console.error(
      `self-check: policyAssignments inventory drift (expected=${assignments.length}, observed=${selfCheckCount}); marking discovery_status=PARTIAL`,
    );
  }
  const discoveredAt = isoNow(now);
  const discoveryMetadata = buildDiscoveryMetadata({
    findings,
    subscriptionId,
    managementGroups: extractManagementGroups(keptAssignments),
    pageCounts: {
      policyAssignments: assignments.length,
      policyDefinitions: defs.size,
      policyExemptions: exemptions.length,
    },
    discoveredAt,
    discoveryStatus,
  });
  return {
    schema_version: "governance-constraints-v1",
    project,
    discovery_options: { include_defender_auto: includeDefenderAuto },
    subscription_id: subscriptionId,
    discovered_at: discoveredAt,
    source: "azure-policy-rest-api",
    discovery_status: discoveryStatus,
    discovery_metadata: discoveryMetadata,
    discovery_summary: {
      assignment_total: assignments.length,
      assignment_kept: keptAssignments.length,
      defender_auto_filtered: filteredDefender.length,
      subscription_scope_count: keptAssignments.filter(
        (assignment) =>
          !String(assignment.properties?.scope ?? "")
            .toLowerCase()
            .includes("/providers/microsoft.management/"),
      ).length,
      management_group_inherited_count: keptAssignments.filter((assignment) =>
        String(assignment.properties?.scope ?? "")
          .toLowerCase()
          .includes("/providers/microsoft.management/"),
      ).length,
      blocker_count: blockers,
      auto_remediate_count: autoRemediate,
      informational_count: findings.filter((finding) => finding.classification === "informational").length,
      audit_count: auditCount,
      disabled_count: disabledCount,
      exempted_count: exempted,
    },
    assignment_inventory: assignmentInventory,
    findings,
    policies: findings,
    member_policy_index: [...defs.keys()].sort(),
    tags_required: extractTagsRequired(findings),
    allowed_locations: extractAllowedLocations(findings),
  };
}

export function cacheIsFresh(cached, now = new Date()) {
  const metadata = cached.discovery_metadata;
  if (!metadata || typeof metadata !== "object" || metadata.discovery_status !== "COMPLETE") return false;
  const ttlDays = metadata.ttl_days;
  if (typeof ttlDays !== "number" || !Number.isInteger(ttlDays) || ttlDays <= 0) return false;
  const discoveredAt = parseAzureDate(metadata.discovered_at);
  if (!discoveredAt) return false;
  for (const finding of cached.findings ?? []) {
    const exemption = finding.exemption;
    if (exemption !== null && exemption !== undefined) {
      if (
        !coveringExemption(
          [exemption],
          cached.subscription_id ?? "",
          finding.scope ?? "",
          finding.policy_definition_reference_id,
          now,
        )
      )
        return false;
    }
  }
  const ageSeconds = (now.getTime() - discoveredAt.getTime()) / 1000;
  return ageSeconds >= 0 && ageSeconds <= ttlDays * 86_400;
}

export function writeJsonEnvelope(filePath, envelope) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`);
}

export function writeStableJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${stableStringify(value)}\n`);
}
