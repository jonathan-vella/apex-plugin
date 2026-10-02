#!/usr/bin/env node
// Minimal dependency-free MCP server (newline-delimited JSON-RPC over stdio) for the spike.
// Its single tool reports where the server runs, proving `${PLUGIN_ROOT}` expansion and bundled
// Node execution in each client.
import { createInterface } from "node:readline";
import { homedir, platform, release } from "node:os";
import { fileURLToPath } from "node:url";

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");

const TOOL = {
  name: "spike_echo",
  description: "Echo text back with facts about where this plugin MCP server is running.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "Any text to echo back." } },
    required: ["text"],
  },
};

function facts(text) {
  return {
    echo: text,
    os: `${platform()} ${release()}`,
    node: process.version,
    home: homedir(),
    cwd: process.cwd(),
    script: fileURLToPath(import.meta.url),
    PLUGIN_ROOT: process.env.PLUGIN_ROOT ?? null,
    PLUGIN_DATA: process.env.PLUGIN_DATA ?? null,
    CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT ?? null,
  };
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (id === undefined) return;
  switch (method) {
    case "initialize":
      send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "apex-spike", version: "0.0.1" },
        },
      });
      break;
    case "ping":
      send({ id, result: {} });
      break;
    case "tools/list":
      send({ id, result: { tools: [TOOL] } });
      break;
    case "tools/call":
      if (params?.name !== TOOL.name) {
        send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
        break;
      }
      send({
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(facts(String(params?.arguments?.text ?? "")), null, 2) }],
        },
      });
      break;
    default:
      send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
