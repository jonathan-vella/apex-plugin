# APEX plugin changelog

Each release of the `apex` plugin needs an entry here; `npm run publish:plugin` refuses to publish a version without
one, and clients only update when the version changes.

## [0.10.0] - Unreleased

First pilot package (backlog BL-14).

- Agents: 01-Orchestrator, 02-Requirements, 10-Challenger; skills for artifacts, defaults, context management,
  golden principles and the workflow engine.
- `apex` MCP server: workflow progress tools, document outlines and tier extracts, handoff, and transcript-backed
  review requests and records.
- Hooks: subagent target control (`APEX-CALLER`) and rubber-duck transcript capture (`APEX-REVIEW`), in bash and
  PowerShell.
