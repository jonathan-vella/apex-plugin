# apex-plugin

Home of the APEX agent plugin for GitHub Copilot. It currently contains only **`apex-spike`**, a
throwaway plugin that checks whether plugin agents, skills, hooks and MCP servers work in every
target client before APEX is rebuilt as a plugin.

## Target clients

| Client                    | Operating system    | Project location   |
| ------------------------- | ------------------- | ------------------ |
| VS Code (Copilot harness) | Windows             | Windows filesystem |
| GitHub Copilot app        | Windows             | Windows filesystem |
| Copilot CLI               | Linux (WSL is fine) | Linux filesystem   |

## Prerequisites

- Node.js 22 or later on the `PATH` of each machine (Windows and Linux).
- On Windows, PowerShell 7 (`pwsh`) for Copilot hooks.

## Install the spike

The repository is also a plugin marketplace (`.github/plugin/marketplace.json`).

- **Copilot CLI (Linux):**

  ```bash
  copilot plugin marketplace add jonathan-vella/apex-plugin
  copilot plugin install apex-spike@apex
  ```

- **VS Code (Windows):** enable `chat.plugins.enabled`, add `jonathan-vella/apex-plugin` to
  `chat.plugins.marketplaces`, then run **Chat: Plugins** and install `apex-spike`. A plugin installed
  with the Copilot CLI on the same machine is also picked up by VS Code. Install through **one**
  channel only: two copies of `apex-spike` register duplicate MCP server names, and VS Code then
  fails to start them (`MCP server "apex-spike" has no installed config to restart`). Run VS Code
  locally, not in WSL or a dev container, for the `vscode-windows` label.
- **GitHub Copilot app (Windows):** **Customize** → **Plugins** → marketplace settings (gear icon) →
  add `jonathan-vella/apex-plugin` → install `apex-spike`.

## Run the spike

1. Open any project on that machine's own filesystem, with the model picker on **Auto**.
2. Select the `apex-spike` agent (agent picker, or `/agent`).
3. Send: `Run the spike. Client label: <vscode-windows | app-windows | cli-linux>`.
4. Approve tool and hook prompts when asked. Keep the agent's final table.
5. Produce the hook report and keep it with the table:

   ```text
   node tools/spike-report.mjs <client-label>
   ```

   Run it from a clone of this repository, or from the installed plugin's folder. Logs are in
   `~/.apex-plugin-spike/logs` (`%USERPROFILE%\.apex-plugin-spike\logs` on Windows). Delete that folder
   between clients on the same machine.

## Layout

```text
.github/plugin/marketplace.json        marketplace listing
plugins/apex-spike/
  plugin.json                          Agent Plugins 1.0 manifest
  mcp.json                             bundled Node MCP server + apex-spike-azure (azure-mcp via npx)
  mcp/server.mjs                       dependency-free MCP server
  skills/apex-spike-check/             skill that runs a bundled Node script
  com.github.copilot/agents/           the apex-spike agent
  com.github.copilot/hooks/            hooks.json (generated) + hook.mjs
tools/generate-hooks.mjs               regenerates hooks.json
tools/spike-report.mjs                 summarises hook logs
```

## Licence

MIT. See [LICENSE](LICENSE).
