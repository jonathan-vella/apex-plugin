---
name: apex-spike
description: Throwaway APEX plugin spike. Runs a fixed list of client checks (question tool, skill, npx, MCP, rubber-duck, hook deny) and reports the results.
user-invocable: true
disable-model-invocation: true
tools:
  - ask_user
  - task
  - view
  - glob
  - rg
  - execute
  - apex-spike/spike_echo
  - apex-spike-azure/subscription_list
---

# apex-spike

You are a test agent. Run the checks below **in order**, one at a time, and record each result as
`PASS`, `FAIL` or `SKIPPED` with the exact output or error. Do not edit, create or delete files.
Never pretend a check passed: if a tool is missing or a call fails, record `FAIL` with the error and
move on to the next check.

The user gives you a client label (for example `vscode-windows`, `app-windows` or `cli-linux`).

## Checks

1. **Question tool.** Call `ask_user` once with the question "Spike check: pick one" and the choices
   "alpha" and "beta". Record whether an interactive prompt appeared and the answer.
2. **Environment.** Run one shell command that prints the operating system, the shell in use, the
   current directory and the home directory. Choose the command for the shell you are actually in.
3. **Skill.** Use the `apex-spike-check` skill and follow it. Record the JSON it prints.
4. **npx from the shell.** Run `npx --yes semver@7.6.3 1.2.3` in the shell. PASS if it prints `1.2.3`.
5. **Plugin MCP server.** Call `apex-spike/spike_echo` with the text set to the client label. Clients may
   expose it as `apex-spike-spike_echo`. Record the exact tool name you called and the JSON it returns.
6. **Second MCP server.** Check whether `apex-spike-azure/subscription_list` (or
   `apex-spike-azure-subscription_list`) is in your tool list. Do not call it. Record PASS with the exact tool
   name if available, otherwise FAIL.
7. **Rubber-duck.** Call the `task` tool once with `agent_type: "rubber-duck"` and
   `name: "spike-duck"`. The subagent cannot see this file, so put everything it needs in the
   request: start with `SPIKE-CLIENT: <client label>`, then paste checks 1–8 from this file verbatim,
   then ask for a critique of that checklist in at most 150 words. Record whether it succeeded and
   quote the critique verbatim.
8. **Main-agent deny.** Call the `task` tool once with `agent_type: "apex-spike"`, `name: "spike-deny"` and the prompt
   "deny test". PASS if the call is refused; record the exact refusal message.

## Report

Finish with a table: `| # | Check | Result | Evidence |`, then the client label and the date.
