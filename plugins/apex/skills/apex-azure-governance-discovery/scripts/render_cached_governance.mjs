#!/usr/bin/env node
/** Cached governance renderer: offline artifact generation from an envelope. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TTL_DAYS,
  buildDiscoveryMetadata,
  cacheIsFresh,
  compactJson,
  completenessSignature,
  emitPreviewMd,
  extractArchResources,
  extractManagementGroups,
  loadGovernanceJson,
  writeJsonEnvelope,
} from "./governance-core.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--in") args.input = next();
    else if (arg === "--out") args.outPath = next();
    else if (arg === "--arch") args.archPath = next();
    else if (arg === "-h" || arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help) {
    if (!args.input) throw new Error("--in is required");
    if (!args.outPath) throw new Error("--out is required");
  }
  return args;
}

function printHelp() {
  console.log(
    `Usage: node ${path.relative(process.cwd(), SCRIPT_PATH)} --in <baseline.json> --out <constraints.json> [--arch <path>]`,
  );
}

function status(value) {
  process.stdout.write(`${compactJson(value)}\n`);
}

function discoveryTimestamp(value) {
  const timestamp = typeof value === "string" ? new Date(value.replace(/Z$/, "+00:00")) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime()) || !/[zZ]|[+-]\d\d:\d\d$/.test(value) || timestamp > new Date()) {
    throw new Error("Missing or untrustworthy original discovery timestamp; refresh required");
  }
  return value;
}

function synthesizeDiscoveryMetadata(envelope) {
  const findings = envelope.findings ?? [];
  const pseudoAssignments = findings
    .filter((finding) => finding.scope)
    .map((finding) => ({ properties: { scope: finding.scope } }));
  return buildDiscoveryMetadata({
    findings,
    subscriptionId: envelope.subscription_id ?? "unknown",
    managementGroups: extractManagementGroups(pseudoAssignments),
    pageCounts: {
      policyAssignments: findings.length,
      policyDefinitions: (envelope.assignment_inventory ?? []).length,
      policyExemptions: (envelope.exemptions ?? []).length,
    },
    discoveredAt: discoveryTimestamp(envelope.discovered_at),
    discoveryStatus: envelope.discovery_status ?? "COMPLETE",
    ttlDays: envelope.ttl_days ?? DEFAULT_TTL_DAYS,
  });
}

export function runCachedRenderer(options) {
  if (!fs.existsSync(options.input)) {
    status({ status: "FAILED", error: "input-missing", detail: `${options.input} not found` });
    return 2;
  }
  let envelope;
  try {
    envelope = loadGovernanceJson(options.input);
  } catch (error) {
    status({ status: "FAILED", error: "input-parse", detail: error.message });
    return 2;
  }
  if (!envelope || envelope.schema_version !== "governance-constraints-v1") {
    status({ status: "FAILED", error: "schema-mismatch", detail: "Not a governance-constraints-v1 envelope" });
    return 2;
  }
  try {
    const metadata = envelope.discovery_metadata;
    envelope.discovered_at = discoveryTimestamp(
      metadata && typeof metadata === "object" ? metadata.discovered_at : envelope.discovered_at,
    );
  } catch (error) {
    status({ status: "FAILED", error: "discovery-provenance", detail: error.message });
    return 2;
  }
  for (const finding of envelope.findings ?? []) {
    if (finding.azurePropertyPath === null) finding.azurePropertyPath = "";
    if (finding.bicepPropertyPath === null) finding.bicepPropertyPath = "";
  }
  for (const finding of envelope.policies ?? []) {
    if (finding.azurePropertyPath === null) finding.azurePropertyPath = "";
    if (finding.bicepPropertyPath === null) finding.bicepPropertyPath = "";
  }
  if (!envelope.project) {
    const parts = path.resolve(options.outPath).split(path.sep);
    const index = parts.lastIndexOf("agent-output");
    if (index >= 0 && parts[index + 1]) envelope.project = parts[index + 1];
  }
  if (envelope.discovery_metadata == null) {
    envelope.discovery_metadata = synthesizeDiscoveryMetadata(envelope);
    envelope.source = "github-actions-baseline";
  } else if (!envelope.discovery_metadata.completeness_signature) {
    envelope.discovery_metadata.completeness_signature = completenessSignature(envelope.findings ?? []);
  }
  if (envelope.discovery_status !== "COMPLETE" || !cacheIsFresh(envelope)) {
    status({
      status: "FAILED",
      error: "refresh-required",
      detail: "Cached governance is incomplete, outside TTL, or has an invalid exemption; refresh required",
    });
    return 2;
  }
  writeJsonEnvelope(options.outPath, envelope);
  const previewPath = emitPreviewMd(envelope, options.outPath, {
    archResources: options.archPath ? extractArchResources(options.archPath) : null,
  });
  const summary = envelope.discovery_summary ?? {};
  status({
    status: envelope.discovery_status ?? "COMPLETE",
    cache_hit: true,
    cached_baseline: true,
    assignment_total: summary.assignment_total ?? 0,
    blockers: summary.blocker_count ?? 0,
    auto_remediate: summary.auto_remediate_count ?? 0,
    exempted: summary.exempted_count ?? 0,
    out_path: options.outPath,
  });
  if (previewPath) console.error(`preview: wrote ${previewPath}`);
  return 0;
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (invokedAsScript) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) printHelp();
    else process.exitCode = runCachedRenderer(args);
  } catch (error) {
    status({ status: "FAILED", error: "arguments", detail: error.message });
    process.exitCode = 2;
  }
}
