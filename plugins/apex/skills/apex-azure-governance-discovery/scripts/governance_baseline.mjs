#!/usr/bin/env node
/** Load and query governance baselines stored as JSON or gzip-compressed JSON. */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { compactJson, loadGovernanceJson, resolvePath } from "./governance-core.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = { compact: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--get") args.field = next();
    else if (arg === "--subscription") args.subscription = next();
    else if (arg === "--compact") args.compact = true;
    else if (arg === "-h" || arg === "--help") args.help = true;
    else if (!args.baseline) args.baseline = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && !args.baseline) throw new Error("baseline is required");
  if (args.field && args.subscription) throw new Error("--get and --subscription are mutually exclusive");
  return args;
}

function printHelp() {
  console.log(
    `Usage: node ${path.relative(process.cwd(), SCRIPT_PATH)} <baseline> [--get <field>|--subscription <id>] [--compact]`,
  );
}

export function runGovernanceBaseline(options) {
  const baseline = loadGovernanceJson(options.baseline);
  let value = baseline;
  if (options.field) value = resolvePath(baseline, options.field);
  else if (options.subscription) value = baseline.subscriptions[options.subscription];
  if (value === undefined) throw new Error(options.field || options.subscription);
  if (value && typeof value === "object")
    console.log(options.compact ? compactJson(value) : JSON.stringify(value, null, 2));
  else if (value === null) console.log("null");
  else console.log(value);
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (invokedAsScript) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) printHelp();
    else runGovernanceBaseline(args);
  } catch (error) {
    console.error(`governance baseline error: ${error.message}`);
    process.exitCode = 2;
  }
}
