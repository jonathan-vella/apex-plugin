#!/usr/bin/env node
/** Deterministic Azure Policy discovery for 04g-Governance. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cacheIsFresh,
  checkAuth,
  compactJson,
  defaultAzRest,
  discover,
  emitPreviewMd,
  extractArchResources,
  getDefaultSubscription,
  writeJsonEnvelope,
} from "./governance-core.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = { subscription: "default", refresh: false, includeDefenderAuto: false, verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--project") args.project = next();
    else if (arg === "--out") args.outPath = next();
    else if (arg === "--subscription") args.subscription = next();
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--arch") args.archPath = next();
    else if (arg === "--include-defender-auto") args.includeDefenderAuto = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg === "-h" || arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help) {
    if (!args.project) throw new Error("--project is required");
    if (!args.outPath) throw new Error("--out is required");
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node ${path.relative(process.cwd(), SCRIPT_PATH)} --project <name> --out <path> [options]

Options:
  --project <name>             Project name for cache key and provenance.
  --out <path>                 Destination 04-governance-constraints.json.
  --subscription <id|default>  Subscription ID. "default" uses az account show.
  --refresh                    Force re-discovery even if the output cache is fresh.
  --arch <path>                Architecture assessment for preview mapping.
  --include-defender-auto      Retain Defender-for-Cloud auto-assignments.
  --verbose                    Emit per-assignment filter notes on stderr.
  -h, --help                   Show this help.
`);
}

function emitStatus(status) {
  process.stdout.write(`${compactJson(status)}\n`);
}

function emitPreview(envelope, limit = 20) {
  const summary = envelope.discovery_summary;
  console.log(
    `\n${envelope.subscription_id}: ${summary.assignment_kept} kept assignments (of ${summary.assignment_total}; ${summary.defender_auto_filtered} Defender auto filtered); ${summary.blocker_count} blockers, ${summary.auto_remediate_count} auto-remediate, ${summary.exempted_count} exempted.`,
  );
  console.log("");
  console.log("| Effect | Classification | Category | Policy | Assignment |");
  console.log("|---|---|---|---|---|");
  for (const finding of envelope.findings.slice(0, limit)) {
    console.log(
      `| ${finding.effect} | ${finding.classification} | ${finding.category} | ${finding.display_name} | ${finding.assignment_display_name} |`,
    );
  }
  if (envelope.findings.length > limit)
    console.log(`\n… ${envelope.findings.length - limit} more in ${envelope._out_path}`);
}

export async function runDiscoverCli(options) {
  let subscriptionId;
  try {
    subscriptionId = options.subscription === "default" ? await getDefaultSubscription() : options.subscription;
  } catch (error) {
    emitStatus({ status: "FAILED", error: "subscription-resolution", detail: error.message });
    console.error("ERROR: could not resolve subscription via `az account show`.");
    return 2;
  }

  if (fs.existsSync(options.outPath) && !options.refresh) {
    try {
      const cached = JSON.parse(fs.readFileSync(options.outPath, "utf8"));
      if (
        cached &&
        cached.schema_version === "governance-constraints-v1" &&
        cached.project === options.project &&
        String(cached.subscription_id ?? "").toLowerCase() === subscriptionId.toLowerCase() &&
        JSON.stringify(cached.discovery_options) ===
          JSON.stringify({ include_defender_auto: options.includeDefenderAuto }) &&
        cached.discovery_status === "COMPLETE" &&
        Array.isArray(cached.findings) &&
        cacheIsFresh(cached) &&
        cached.discovery_metadata?.scope &&
        String(cached.discovery_metadata.scope.subscription_id ?? "").toLowerCase() === subscriptionId.toLowerCase()
      ) {
        if (options.archPath)
          emitPreviewMd(cached, options.outPath, { archResources: extractArchResources(options.archPath) });
        const summary = cached.discovery_summary ?? {};
        emitStatus({
          status: "COMPLETE",
          cache_hit: true,
          assignment_total: summary.assignment_total ?? 0,
          blockers: summary.blocker_count ?? 0,
          auto_remediate: summary.auto_remediate_count ?? 0,
          exempted: summary.exempted_count ?? 0,
          out_path: options.outPath,
        });
        console.log(
          `cache hit: reusing ${options.outPath} (${cached.findings.length} findings; pass --refresh to re-discover)`,
        );
        return 0;
      }
    } catch {
      // Corrupt cache falls through to live discovery, matching the Python path.
    }
  }

  try {
    await checkAuth();
  } catch (error) {
    emitStatus({ status: "FAILED", error: "auth", detail: error.message });
    console.error("ERROR: Azure ARM token unavailable. Run `az login --use-device-code`.");
    return 2;
  }

  let envelope;
  try {
    envelope = await discover(subscriptionId, {
      project: options.project,
      includeDefenderAuto: options.includeDefenderAuto,
      azRest: options.azRest ?? defaultAzRest,
      verbose: options.verbose,
    });
  } catch (error) {
    emitStatus({ status: "FAILED", error: "unexpected", detail: error.message });
    console.error(`ERROR: unexpected failure: ${error.message}`);
    return 2;
  }

  envelope._out_path = options.outPath;
  writeJsonEnvelope(options.outPath, envelope);
  const archResources = options.archPath ? extractArchResources(options.archPath) : null;
  emitPreviewMd(envelope, options.outPath, { archResources });
  const summary = envelope.discovery_summary;
  emitStatus({
    status: envelope.discovery_status,
    cache_hit: false,
    assignment_total: summary.assignment_total,
    blockers: summary.blocker_count,
    auto_remediate: summary.auto_remediate_count,
    exempted: summary.exempted_count,
    out_path: options.outPath,
  });
  emitPreview(envelope);
  return envelope.discovery_status === "COMPLETE" ? 0 : 1;
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (invokedAsScript) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      process.exitCode = await runDiscoverCli(args);
    }
  } catch (error) {
    emitStatus({ status: "FAILED", error: "arguments", detail: error.message });
    process.exitCode = 2;
  }
}
