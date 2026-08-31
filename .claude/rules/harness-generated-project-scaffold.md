---
paths:
  - "project-template/**"
---
<!-- generated-by: claude-engineering-harness -->
# The template copied into user repositories

The template is the only part of the payload the user is expected to own and edit afterwards, and `preflight.sh` is the one file initialization will not overwrite. Its behaviour around local infrastructure was reported by a real project whose stated policy is that Supabase stays down, so the record-and-restore split is deliberate rather than incidental.

- Keep the `generated-by: claude-engineering-harness` marker in every generated file: `init-project.sh` uses it to decide what it may replace and what it must preserve as the user's own.
- `preflight.sh` must never reset, recreate or delete a local database to recover from a failed start. It stops and reports the environment problem instead.
- Bound every wait and keep it overridable (`HARNESS_DOCKER_WAIT_SECONDS`, `HARNESS_SUPABASE_WAIT_SECONDS`), and keep `HARNESS_AUTO_INFRA=0` meaning check-only.
- Infrastructure the preflight starts is either recorded through `HARNESS_INFRA_STARTED_FILE` for a one-shot caller to undo, or announced out loud with the command that stops it. Starting a stack silently and walking away is the original defect.
- Bring up an unrelated Compose file only when the repository genuinely references Compose or `.claude/auto-compose` exists; Supabase owns its own Compose lifecycle.
- Guard execution on the executable bit (`-x`), which is what the consent model withholds from an unapproved preflight. Do not replace that test with a content check.
- These files are copied into a user's repository and are then theirs to edit. Keep them readable, stack-agnostic and free of anything that assumes the harness is present.

Evidence used during harness analysis: `project-template/.claude/preflight.sh`, `tools/init-project.sh`, `tests/init-project.test.mjs`, `tests/consent.test.mjs`
