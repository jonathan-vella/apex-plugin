#!/usr/bin/env node
// Spike hook for every event. Logs each payload with environment facts, saves rubber-duck
// transcripts, and denies `task` calls whose target is the spike's own main agent.
// Any internal error allows the call: a spike must never lock up a session.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const event = process.argv[2] ?? "unknown";
const logDir = join(homedir(), ".apex-plugin-spike", "logs");
const MAIN_AGENT = /(^|[:\-/])apex-spike$/i;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseArgs(raw) {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

const text = readStdin();
let output = "";

try {
  mkdirSync(logDir, { recursive: true });
  const payload = text ? JSON.parse(text) : {};
  const sha256 = createHash("sha256").update(text).digest("hex");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /PLUGIN|^COPILOT_|^CLAUDE_|^SHELL$|^COMSPEC$|^PSModulePath$|^TERM_PROGRAM$/i.test(key),
    ),
  );
  const toolArgs = parseArgs(payload.toolArgs ?? payload.tool_input);

  if (event === "preToolUse" && (payload.toolName ?? payload.tool_name) === "task") {
    const target = String(toolArgs?.agent_type ?? toolArgs?.agentType ?? "");
    if (MAIN_AGENT.test(target)) {
      output = JSON.stringify({
        permissionDecision: "deny",
        permissionDecisionReason: `apex-spike hook: "${target}" is a main agent and cannot run as a subagent.`,
      });
    }
  }

  const reviewText =
    event === "subagentStop" && /rubber-duck/i.test(String(payload.agentType ?? payload.agentName ?? ""))
      ? String(payload.response ?? "")
      : "";
  let transcript = null;
  if (reviewText) {
    const reviewSha = createHash("sha256").update(reviewText).digest("hex");
    transcript = join(logDir, `rubber-duck-${Date.now()}-${reviewSha.slice(0, 12)}.md`);
    writeFileSync(transcript, reviewText);
  }

  appendFileSync(
    join(logDir, `${event}.jsonl`),
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      os: `${platform()} ${release()}`,
      node: process.version,
      cwd: process.cwd(),
      script: fileURLToPath(import.meta.url),
      env,
      chars: text.length,
      sha256,
      decision: output ? "deny" : "none",
      transcript,
      payload,
    }) + "\n",
  );
} catch (error) {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "errors.log"), `${new Date().toISOString()} ${event} ${error?.stack ?? error}\n`);
  } catch {
    // Nowhere left to record the failure; still allow the call.
  }
}

if (output) process.stdout.write(output);
process.exit(0);
