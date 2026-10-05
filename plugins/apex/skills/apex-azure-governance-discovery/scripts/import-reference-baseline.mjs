#!/usr/bin/env node
/** Import the committed ALZ reference baseline into a project constraints file. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_BASELINE_PATH = path.join(SKILL_DIR, "references", "alz-reference-baseline.json");

function parseArgs(argv) {
  const args = { baselinePath: DEFAULT_BASELINE_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--project") args.project = next();
    else if (arg === "--out") args.outPath = next();
    else if (arg === "--baseline") args.baselinePath = next();
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node ${path.relative(process.cwd(), SCRIPT_PATH)} --project <name> --out <path>

Options:
  --project <name>       Project name to stamp into the envelope.
  --out <path>           Destination 04-governance-constraints.json path.
  --baseline <path>      Optional baseline override for tests. Defaults to the committed skill reference.
  -h, --help             Show this help.
`);
}

function readBaseline(baselinePath) {
  const parsed = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("reference baseline root must be an object");
  }
  if (parsed.schema_version !== "governance-constraints-v1" || parsed.source !== "reference") {
    throw new Error("baseline is not a governance-constraints-v1 reference envelope");
  }
  return parsed;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}

function projectFromOutPath(outPath) {
  const parts = path.resolve(outPath).split(path.sep);
  const index = parts.lastIndexOf("agent-output");
  return index >= 0 && parts[index + 1] ? parts[index + 1] : null;
}

export function importReferenceBaseline({ project, outPath, baselinePath = DEFAULT_BASELINE_PATH }) {
  if (!project || typeof project !== "string") throw new Error("--project is required");
  if (!outPath || typeof outPath !== "string") throw new Error("--out is required");
  const pathProject = projectFromOutPath(outPath);
  if (pathProject && pathProject !== project) {
    throw new Error(`--project (${project}) does not match --out project segment (${pathProject})`);
  }
  const envelope = clone(readBaseline(baselinePath));
  envelope.project = project;
  envelope.source = "reference";
  if (envelope.discovery_metadata?.reference) {
    envelope.discovery_metadata.reference.source = "reference";
  }
  if (envelope.reference_metadata) envelope.reference_metadata.source = "reference";
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${stableStringify(envelope)}\n`);
  return envelope;
}

export function runImporter(options = {}) {
  const envelope = importReferenceBaseline(options);
  const summary = envelope.discovery_summary ?? {};
  console.log(
    JSON.stringify({
      status: "COMPLETE",
      baseline: "reference",
      project: envelope.project,
      library_tag: envelope.reference_metadata?.tag,
      generated_at: envelope.reference_metadata?.generated_at,
      blockers: summary.blocker_count ?? 0,
      auto_remediate: summary.auto_remediate_count ?? 0,
      out_path: path.resolve(options.outPath),
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
      runImporter(args);
    }
  } catch (error) {
    console.error(`import-reference-baseline error: ${error.message}`);
    process.exitCode = 2;
  }
}
