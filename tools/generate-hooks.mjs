// Generates plugins/apex-spike/com.github.copilot/hooks/hooks.json.
// The docs do not say which plugin-root variable (if any) hooks receive, so each command tries
// PLUGIN_ROOT, COPILOT_PLUGIN_ROOT, CLAUDE_PLUGIN_ROOT and the working directory, and records the
// environment when none resolves. Every command exits 0 so the spike cannot block a session.
import { writeFileSync } from "node:fs";

const SCRIPT = "com.github.copilot/hooks/hook.mjs";
const EVENTS = ["preToolUse", "postToolUse", "subagentStart", "subagentStop"];

const bash = (event) =>
  [
    'p=""',
    `for r in "$PLUGIN_ROOT" "$COPILOT_PLUGIN_ROOT" "$CLAUDE_PLUGIN_ROOT" "."; do if [ -n "$r" ] && [ -f "$r/${SCRIPT}" ]; then p="$r/${SCRIPT}"; break; fi; done`,
    `if [ -n "$p" ]; then node "$p" ${event}; else mkdir -p "$HOME/.apex-plugin-spike/logs"; { date -u; pwd; env | grep -iE 'plugin|copilot|claude'; } >> "$HOME/.apex-plugin-spike/logs/unresolved-${event}.log"; cat > /dev/null; fi`,
    "exit 0",
  ].join("; ");

const powershell = (event) =>
  [
    "$p = $null",
    `foreach ($r in @($env:PLUGIN_ROOT, $env:COPILOT_PLUGIN_ROOT, $env:CLAUDE_PLUGIN_ROOT, '.')) { if ($r -and (Test-Path (Join-Path $r '${SCRIPT}'))) { $p = Join-Path $r '${SCRIPT}'; break } }`,
    "$in = [Console]::In.ReadToEnd()",
    `if ($p) { $in | node $p ${event} } else { $d = Join-Path $HOME '.apex-plugin-spike/logs'; New-Item -ItemType Directory -Force $d | Out-Null; ((Get-Date -Format o) + ' ' + (Get-Location) + ' ' + ((Get-ChildItem env: | Where-Object Name -match 'PLUGIN|COPILOT|CLAUDE' | ForEach-Object { $_.Name + '=' + $_.Value }) -join ';')) | Add-Content (Join-Path $d 'unresolved-${event}.log') }`,
    "exit 0",
  ].join("; ");

const hooks = Object.fromEntries(
  EVENTS.map((event) => [
    event,
    [{ type: "command", bash: bash(event), powershell: powershell(event), timeoutSec: 15 }],
  ]),
);

writeFileSync(
  new URL("../plugins/apex-spike/com.github.copilot/hooks/hooks.json", import.meta.url),
  JSON.stringify({ version: 1, hooks }, null, 2) + "\n",
);
console.log("wrote hooks.json for", EVENTS.join(", "));
