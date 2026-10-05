#!/usr/bin/env node
/**
 * APEX plugin hook (backlog BL-12). One dependency-free script for every event; `hooks.json` runs it from bash or
 * PowerShell with the event name as the only argument. Input is the Copilot SDK hook payload on stdin.
 *
 * preToolUse  `task` target control: APEX main agents cannot run as subagents, and APEX workers need an
 *             `APEX-CALLER: <agent>` line naming an agent that lists them. Errors deny (fail closed), but only for
 *             `task`: plugin hooks run in every session, so other tools (including `apex-*` MCP tools) always pass.
 * postToolUse Captures `rubber-duck` output verbatim into the project's `.reviews/` folder when the request carries
 *             `APEX-REVIEW: project=<name> step=<key> artifact=<workspace-relative path> nonce=<16 hex>` (issued by the
 *             `apex` reviewRequest tool). Metadata is signed with the per-user review key shared with the `apex`
 *             server (tools/scripts/_lib/review-transcript.mjs; this file stays dependency-free). Never blocks.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENTS_INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apex-assets/agents.json");
export const TRANSCRIPT_SCHEMA = "apex-review-transcript-v1";
const PROJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const STEP_KEYS = new Set(["1", "2", "3", "3_5", "4", "5", "6", "7"]);
const HEADER_LINES = 10;
const ARTIFACT_PATTERN = /^agent-output\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._/-]+$/;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** Accept `toolArgs` as an object or a JSON string, and the snake_case field names some clients send. */
export function readPayload(text) {
  const payload = text.trim() ? JSON.parse(text) : {};
  let args = payload.toolArgs ?? payload.tool_input ?? {};
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = { _raw: args };
    }
  }
  return { payload, toolName: String(payload.toolName ?? payload.tool_name ?? ""), args: args ?? {} };
}

/** "apex-status", "apex/status" and "mcp__apex__status" all name the `apex` server's `status` tool. */
export function apexTool(toolName) {
  const match = toolName.match(/^(?:mcp__apex__|apex[-/])([A-Za-z]+)$/);
  return match ? match[1] : null;
}

/** Lower-case agent id without plugin or folder prefixes, e.g. "apex:01-Orchestrator" → "01-orchestrator". */
export function normalizeAgent(value) {
  return String(value ?? "")
    .trim()
    .replace(/^(?:apex[:/]|_subagents--|_subagents\/)/i, "")
    .replace(/\.agent\.md$/i, "")
    .toLowerCase();
}

/** Index APEX agents by name and file stem: { main: boolean, name, workers: Set<normalized> }. */
export function indexAgents(index) {
  const byId = new Map();
  for (const { path: file, frontmatter } of index.agents ?? []) {
    if (!frontmatter?.name) continue;
    const entry = {
      name: frontmatter.name,
      main: !file.includes("/_subagents/"),
      workers: new Set((frontmatter.agents ?? []).map(normalizeAgent)),
    };
    byId.set(normalizeAgent(frontmatter.name), entry);
    byId.set(normalizeAgent(path.posix.basename(file)), entry);
  }
  return byId;
}

function headerValue(prompt, key) {
  const lines = String(prompt ?? "")
    .split(/\r?\n/)
    .slice(0, HEADER_LINES);
  const line = lines.find((candidate) => candidate.trim().startsWith(`${key}:`));
  return line
    ? line
        .trim()
        .slice(key.length + 1)
        .trim()
    : null;
}

const deny = (reason) => ({ permissionDecision: "deny", permissionDecisionReason: `APEX: ${reason}` });

/** Decide a `task` call. Returns null to allow, or a deny decision. */
export function decideTask(args, agents) {
  const target = normalizeAgent(args.agent_type ?? args.agentType);
  const agent = agents.get(target);
  if (!agent) return null;
  if (agent.main) {
    return deny(
      `"${agent.name}" is a main agent. A person selects it in the agent picker; hand off to it instead of running it as a subagent.`,
    );
  }
  const callerName = headerValue(args.prompt, "APEX-CALLER");
  const fix = `Start the prompt with "APEX-CALLER: <your agent name>" and call only workers your agent lists in agents.`;
  if (!callerName) return deny(`worker "${agent.name}" needs an APEX-CALLER line. ${fix}`);
  const caller = agents.get(normalizeAgent(callerName));
  if (!caller) return deny(`APEX-CALLER "${callerName}" is not an APEX agent. ${fix}`);
  if (!caller.workers.has(target)) {
    return deny(`"${caller.name}" does not list worker "${agent.name}" in its agents. ${fix}`);
  }
  return null;
}

export function preToolUse({ toolName, args }, loadAgents) {
  if (toolName !== "task") return null;
  try {
    return decideTask(args, loadAgents());
  } catch (error) {
    return deny(`subagent check failed, so the call is blocked: ${error.message}. Reinstall the APEX plugin.`);
  }
}

/** Parse `APEX-REVIEW: project=… step=… artifact=…`; returns null when absent or invalid. */
export function parseReviewHeader(prompt) {
  const value = headerValue(prompt, "APEX-REVIEW");
  if (!value) return null;
  const fields = Object.fromEntries(
    value
      .split(/\s+/)
      .map((token) => token.split("="))
      .filter((pair) => pair.length === 2),
  );
  if (!PROJECT_PATTERN.test(fields.project ?? "") || fields.project.includes("..")) return null;
  if (!STEP_KEYS.has(fields.step)) return null;
  if (!ARTIFACT_PATTERN.test(fields.artifact ?? "") || fields.artifact.split("/").includes("..")) return null;
  if (fields.artifact.split("/")[1] !== fields.project) return null;
  if (!/^[0-9a-f]{16}$/.test(fields.nonce ?? "")) return null;
  return { project: fields.project, step: fields.step, artifact: fields.artifact, nonce: fields.nonce };
}

/** Same canonical form and key location as tools/scripts/_lib/review-transcript.mjs (a test keeps them aligned). */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function reviewKey() {
  const file = process.env.APEX_REVIEW_KEY_FILE || path.join(os.homedir(), ".apex", "review-key");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(file, `${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}

function realDirectory(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Not a plain folder: ${target}`);
  return true;
}

function writeOnce(file, content) {
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file).equals(Buffer.from(content))) return false;
    throw new Error(`Refusing to overwrite a different transcript: ${file}`);
  }
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, content, { flag: "wx" });
  fs.renameSync(temporary, file);
  return true;
}

/**
 * Save a rubber-duck result. Names derive from the request nonce and the response hash, so a repeated identical call
 * writes nothing new and a different answer to the same request gets its own file.
 */
export function captureTranscript({ payload, toolName, args }, now = new Date()) {
  if (toolName !== "task" || normalizeAgent(args.agent_type ?? args.agentType) !== "rubber-duck") return null;
  const header = parseReviewHeader(args.prompt);
  if (!header) return null;
  const result = payload.toolResult ?? {};
  const response = typeof result === "string" ? result : result.textResultForLlm;
  if (typeof response !== "string" || (result.resultType && result.resultType !== "success")) return null;
  const workspace = String(payload.cwd ?? "");
  if (!path.isAbsolute(workspace)) throw new Error("Hook payload has no absolute cwd");
  const outputDir = path.join(workspace, "agent-output");
  const projectDir = path.join(outputDir, header.project);
  if (!realDirectory(outputDir) || !realDirectory(projectDir)) {
    throw new Error(`No project folder agent-output/${header.project} under ${workspace}`);
  }
  const reviewsDir = path.join(projectDir, ".reviews");
  if (!realDirectory(reviewsDir)) fs.mkdirSync(reviewsDir);
  const artifactPath = path.join(workspace, header.artifact);
  const artifactStat = fs.lstatSync(artifactPath, { throwIfNoEntry: false });
  const requestSha = sha256(String(args.prompt));
  const responseSha = sha256(response);
  const name = `rubber-duck-${header.nonce}-${responseSha.slice(0, 12)}`;
  const meta = {
    schema: TRANSCRIPT_SCHEMA,
    nonce: header.nonce,
    project: header.project,
    step: header.step,
    artifact: header.artifact,
    artifact_sha256: artifactStat?.isFile() ? sha256(fs.readFileSync(artifactPath)) : null,
    request_sha256: requestSha,
    response_sha256: responseSha,
    transcript: `${name}.md`,
    session_id: payload.sessionId ?? null,
    captured_at: now.toISOString(),
  };
  meta.signature = createHmac("sha256", reviewKey()).update(canonicalJson(meta)).digest("hex");
  const transcript = path.join(reviewsDir, `${name}.md`);
  const metaFile = path.join(reviewsDir, `${name}.json`);
  const written = writeOnce(transcript, response);
  if (written || !fs.existsSync(metaFile)) writeOnce(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  return { transcript, written };
}

export function run(event, text, { loadAgents, stderr = process.stderr } = {}) {
  let parsed;
  try {
    parsed = readPayload(text);
  } catch (error) {
    stderr.write(`APEX hook: unreadable ${event} payload (${error.message}); call allowed.\n`);
    return "";
  }
  if (event === "preToolUse") {
    const decision = preToolUse(parsed, loadAgents);
    return decision ? JSON.stringify(decision) : "";
  }
  if (event === "postToolUse") {
    try {
      captureTranscript(parsed);
    } catch (error) {
      stderr.write(`APEX hook: review transcript not captured: ${error.message}\n`);
    }
  }
  return "";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = "";
  try {
    input = fs.readFileSync(0, "utf8");
  } catch {
    // No stdin: treat as an empty payload.
  }
  const loadAgents = () => indexAgents(JSON.parse(fs.readFileSync(AGENTS_INDEX, "utf8")));
  const output = run(process.argv[2] ?? "", input, { loadAgents });
  if (output) process.stdout.write(output);
  process.exitCode = 0;
}
