# APEX plugin changelog

Each release of the `apex` plugin needs an entry here; `npm run publish:plugin` refuses to publish a version without
one, and clients only update when the version changes.

## [0.10.3] - Unreleased

Agents no longer stop to verify the model or their own definitions.

- In the 0.10.2 VS Code pilot (Auto), `01-Orchestrator` and `02-Requirements` stopped because the workflow entry
  reference told them to verify the owner and its model. Skills, instructions and prompts now say: the selected agent
  owns its step; a different step means a handoff; not being able to inspect agent definitions or the model never
  blocks. Model-tier wording is gone from runtime guidance.
- `validate:agents` fails when agent, skill, instruction or prompt files ask to verify, require or select a model.

## [0.10.2] - 2026-10-06

Agents run on the model you select.

- Agents and prompts no longer set `model` or `reasoning-effort`, and never refuse or stop because of the session
  model (Auto, HydraFusion or a specific model). In 0.10.1, `01-Orchestrator` refused to start a project under Auto.
- `validate:plugin` and `validate:agents` reject `model`, `reasoning-effort` and `handoffs[].model` in agents and
  prompts.

## [0.10.1] - 2026-10-05

Fix for the first VS Code pilot run, where no questions were asked.

- Main agents list `ask_user` next to `vscode/askQuestions`. Copilot clients (CLI, app and the VS Code Copilot
  harness) ignore the VS Code name and do not map it to `ask_user` (microsoft/vscode#314010), so 0.10.0 agents had no
  question tool there.
- `validate:plugin` fails when an agent lists `vscode/askQuestions` without `ask_user`.

## [0.10.0] - 2026-10-05

First pilot package (backlog BL-14).

- Agents: 01-Orchestrator, 02-Requirements, 10-Challenger; skills for artifacts, defaults, context management,
  golden principles and the workflow engine.
- `apex` MCP server: workflow progress tools, document outlines and tier extracts, handoff, and transcript-backed
  review requests and records.
- Hooks: subagent target control (`APEX-CALLER`) and rubber-duck transcript capture (`APEX-REVIEW`), in bash and
  PowerShell.
