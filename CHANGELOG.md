# Changelog

## Unreleased

- The Stop gate no longer reports a check it could not run as a defect in the change. Exit `3` (no verification strategy applies) and exit `127` (a required command is missing) are announced with their remediation and do not block; every other nonzero exit still blocks. Previously a developer without Docker was told to "fix the verification errors" on every Stop, with no edit that could clear it — the most direct route to deleting `.claude/verify-on-stop` and losing the gate entirely.
- The same treatment for the two conditions the hook detects itself: an enabled gate with no verification command configured, and a `verify` script with no package manager available, are now reported rather than blocking.
- Stop verification falls back to the PostToolUse edit record when git reports a clean tree, so a task that edits files and then commits them is still verified. The record is therefore written whenever either gate is enabled, and Stop verification clears it when the baseline refresh is off.
- Fixed the PostToolUse hook discarding every edit whose path reached it through a symlinked ancestor, which on macOS silently dropped every edit in a repository under `/tmp` or `/var`.
- `init-project.sh` now teaches git to ignore Graft's generated `graft/` directory. Left untracked and unignored, it made `git ls-files --others` permanently non-empty, so the "nothing changed" fast path never fired and the full verification suite ran after every Stop — including sessions that only answered a question. Repositories that deliberately track `graft/` are left alone.
- Added `tests/hooks.test.mjs`: behavioural coverage for both hooks, including the exit-code contract, the clean-tree-but-committed case, and the agreement between the ignore list in `mark-baseline-dirty.sh` and the one in `refresh-baseline.sh` that two comments already claimed was tested.
- The living baseline no longer grows without bound. Retention is capped at 20 active and 15 resolved/stale findings, dropping the lowest severity first, and a new finding is now deduplicated on a normalized title, so a reworded finding is not appended beside the one it restates. Pruning is reported rather than silent.
- Finding IDs are allocated from a persisted `next_finding_id` counter. Capping frees an ID, and allocating from the current maximum would have handed that number to a different finding later, breaking the stable-identity invariant.
- Generated rule bodies are sanitized before they reach the files Claude Code loads as instructions in every session. A leading `@`, which Claude Code resolves as a file import, is neutralized, and markdown link and image targets are stripped while the link text is kept. Paths, globs and filenames were already sanitized; bodies passed through whitespace collapsing only.
- `init-project.sh` names each generated rule file instead of only counting them, and says they load as instructions in every future session, so they get read once before the first task.
- Uninstall restores settings before deleting anything. The step that can fail for an environment reason ran last, after the global files were already gone, and the installed copy of the helper it needs lives inside a directory the removal wipes — so a missing helper or missing Node left the hooks in `settings.json` pointing at scripts that had just been deleted, with no message saying so. The helper is now also looked up in `~/.claude/harness-tools/`.
- `claude-opus-5` / `high` were restated in six places, of which only `HARNESS_DEFAULTS` is authoritative. `install.sh` now reads the values back instead of printing its own copy, and the remaining machine-readable copies — `settings-hook-snippet.json`, which a user copies by hand, and the two shell scripts' analysis fallbacks — are pinned by test.
- Added `tests/render.test.mjs`, covering the renderers' path, glob and filename sanitization and their finding-identity logic; `tests/init-project.test.mjs`, which runs the generator and asserts the `verify.sh` it produces parses, is executable and carries the Dockerfile lint block after the preflight line; and `tests/defaults.test.mjs`, which pins every copy of the harness defaults.
- `init-project.sh` no longer aborts on macOS Bash 3.2 when a repository has none of the conventional top-level source directories (`apps`, `packages`, `src`, `services`, `libs`, `modules`, `docs`). Under `set -u`, Bash 3.2 treats an empty array expansion as an unbound variable, so the fallback description was never reached.
- Uninstall now restores the `model` and `effortLevel` that were set before the first install instead of deleting them. Previously a user with a custom model silently lost it on install/uninstall.
- A value the user sets after installing is treated as deliberate and survives uninstall.
- Uninstall no longer leaves empty `hooks` containers behind, so a settings file it created nothing in round-trips back to its original content.
- `settings.json` is now written through a temporary file and an atomic rename, so an interrupted or failing write cannot truncate it. File permissions are preserved.
- A malformed `settings.json` is now reported as a single error instead of a raw stack trace, and is left untouched.
- Added round-trip tests for install and uninstall under `tests/`.

## 6.0.0

- Added automatic local-environment preflight through `.claude/preflight.sh`.
- Verification now distinguishes environment failures from code/test failures.
- Supabase projects automatically start the local stack when it is configured but stopped.
- On macOS, the preflight can start Docker Desktop and wait for it to become ready.
- Repository-declared Docker Compose infrastructure can be started conservatively when project scripts explicitly reference Compose or `.claude/auto-compose` is present.
- Stop verification reuses the same preflight, so local infrastructure can recover automatically during normal Claude Code work.
- Added `HARNESS_AUTO_INFRA=0` to make infrastructure startup check-only, plus timeout environment variables for Docker and Supabase.
- Graft is now checked against npm during install and project initialization. The harness upgrades only when npm has a newer version and never downgrades a locally newer Graft build.
- Preserves a custom `.claude/preflight.sh`; only harness-generated preflight files are refreshed automatically.

## 5.0.0

- Added living engineering baselines with stable finding IDs.
- Added `.claude/engineering-baseline.json` as machine-readable finding state.
- Added a global PostToolUse hook that records files edited by Claude Code without calling a model.
- Extended the Stop quality gate so baseline refresh runs only after successful verification.
- Added incremental Graft + Claude Opus 5 high baseline revalidation.
- Existing findings can become OPEN, CHANGED, RESOLVED, or STALE.
- Incremental analysis can add concrete NEW findings from the changed blast radius.
- Unrelated findings are not re-audited on every task.
- Baseline refresh failures are fail-soft and retried later; verification failures remain blocking.
- Added full-reanalysis signaling when a change appears to materially alter project architecture.
- Added explicit global policy that baseline findings must never be treated as authoritative over current source and tests.
- Fixed project slug generation so archive directories no longer gain a trailing underscore from newline translation.

## 4.0.0

- Made Graft the standard repository-context layer.
- Added automatic Graft installation and per-project Claude integration.
- Set Claude Opus 5 with high effort as the default model configuration.
- Seeded semantic repository analysis with Graft map and focused context queries.
