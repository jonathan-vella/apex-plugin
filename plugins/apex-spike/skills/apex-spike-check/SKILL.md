---
name: apex-spike-check
description: Spike check for the apex-spike plugin. Use when asked to run the APEX spike skill check. Runs a bundled Node script that reports where it runs and whether npx works.
---

# APEX spike skill check

This skill proves that a plugin skill can run a script bundled next to this `SKILL.md`.

## Steps

1. Work out the absolute path of the folder that contains this `SKILL.md`. Report that path and how
   you found it.
2. Run the bundled script with Node, using its absolute path:

   ```text
   node <skill-folder>/scripts/check.mjs
   ```

3. Report the script's JSON output verbatim. If the command fails, report the exact error.

Do not edit files and do not install anything else.
