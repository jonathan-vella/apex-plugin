#!/usr/bin/env node
// Summarises ~/.apex-plugin-spike/logs into Markdown so results can be pasted back for review.
// Usage: node tools/spike-report.mjs [client-label]
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { join } from "node:path";

const label = process.argv[2] ?? "unlabelled";
const dir = join(homedir(), ".apex-plugin-spike", "logs");
const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const lines = [
  `# apex-spike report: ${label}`,
  "",
  `- Host: ${platform()} ${release()}, Node ${process.version}`,
  `- Logs: ${dir}`,
  "",
];

if (!existsSync(dir)) {
  lines.push("**No log folder.** No plugin hook ran on this machine.");
  console.log(lines.join("\n"));
  process.exit(0);
}

const files = readdirSync(dir).sort();
lines.push(`- Files: ${files.join(", ") || "(none)"}`, "");

const read = (name) =>
  existsSync(join(dir, name))
    ? readFileSync(join(dir, name), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

for (const event of ["preToolUse", "postToolUse", "subagentStart", "subagentStop"]) {
  const entries = read(`${event}.jsonl`);
  lines.push(`## ${event}: ${entries.length} entries`);
  if (entries[0]) {
    const first = entries[0];
    lines.push(`- cwd: \`${first.cwd}\``, `- script: \`${first.script}\``, `- os: ${first.os}`);
    lines.push(
      `- plugin env: ${
        Object.keys(first.env)
          .filter((k) => /(^|_)PLUGIN_(ROOT|DATA)$/i.test(k))
          .join(", ") || "(none)"
      }`,
    );
    lines.push(
      `- shell env: ${["SHELL", "COMSPEC", "TERM_PROGRAM"].map((k) => `${k}=${first.env[k] ?? "-"}`).join(", ")}`,
    );
    lines.push(`- payload keys: ${Object.keys(first.payload).join(", ")}`);
  }
  lines.push("");
}

const tasks = read("postToolUse.jsonl").filter((e) => (e.payload.toolName ?? e.payload.tool_name) === "task");
const stops = read("subagentStop.jsonl");
lines.push("## task calls (postToolUse)");
for (const entry of tasks) {
  const args =
    typeof entry.payload.toolArgs === "string" ? JSON.parse(entry.payload.toolArgs) : (entry.payload.toolArgs ?? {});
  const result = entry.payload.toolResult?.textResultForLlm ?? "";
  const match = stops.find((stop) => stop.payload.response && result.includes(String(stop.payload.response).trim()));
  lines.push(
    `- ${entry.at} agent_type=\`${args.agent_type}\` result=${result.length} chars sha=${sha(result)} ` +
      `matches subagentStop.response: ${match ? `yes (${match.payload.agentType})` : "no"}`,
  );
}
lines.push("", "## subagentStop");
for (const stop of stops) {
  const response = String(stop.payload.response ?? "");
  lines.push(
    `- ${stop.at} agentType=\`${stop.payload.agentType}\` response=${response.length} chars sha=${sha(response)} transcript=${stop.transcript ?? "-"}`,
  );
}
const denies = read("preToolUse.jsonl").filter((e) => e.decision === "deny");
lines.push("", `## Denied by hook: ${denies.length}`);
for (const deny of denies) lines.push(`- ${deny.at} ${JSON.stringify(deny.payload.toolArgs).slice(0, 160)}`);

for (const name of files.filter((f) => f.startsWith("unresolved-") || f === "errors.log")) {
  lines.push("", `## ${name}`, "```text", readFileSync(join(dir, name), "utf8").trim().slice(-2000), "```");
}

console.log(lines.join("\n"));
