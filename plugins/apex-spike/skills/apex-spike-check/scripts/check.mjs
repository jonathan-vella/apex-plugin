#!/usr/bin/env node
// Skill check: proves a skill can run a script bundled next to its SKILL.md, and that `npx`
// (a .cmd shim on Windows) can be launched from Node on every platform.
import { spawnSync } from "node:child_process";
import { homedir, platform, release } from "node:os";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
// Node refuses to spawn .cmd/.bat without a shell (CVE-2024-27980), so Windows needs shell: true.
const npx = spawnSync("npx", ["--yes", "semver@7.6.3", "1.2.3"], {
  encoding: "utf8",
  shell: isWindows,
  timeout: 120000,
});

console.log(
  JSON.stringify(
    {
      check: "apex-spike-check",
      os: `${platform()} ${release()}`,
      node: process.version,
      home: homedir(),
      cwd: process.cwd(),
      script: fileURLToPath(import.meta.url),
      env: {
        PLUGIN_ROOT: process.env.PLUGIN_ROOT ?? null,
        COPILOT_PLUGIN_ROOT: process.env.COPILOT_PLUGIN_ROOT ?? null,
        CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT ?? null,
        SHELL: process.env.SHELL ?? null,
        COMSPEC: process.env.COMSPEC ?? null,
      },
      npx: {
        ok: npx.status === 0 && npx.stdout.trim() === "1.2.3",
        status: npx.status,
        stdout: npx.stdout?.trim() ?? "",
        error: npx.error?.message ?? (npx.stderr?.trim().slice(0, 300) || null),
      },
    },
    null,
    2,
  ),
);
