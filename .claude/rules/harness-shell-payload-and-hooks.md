---
paths:
  - "install.sh"
  - "uninstall.sh"
  - "tools/*.sh"
  - "src/hooks/*.sh"
  - "project-template/.claude/*.sh"
---
<!-- generated-by: claude-engineering-harness -->
# Shipped shell: portability, consent and the exit-code contract

These scripts run on other people's machines from a home directory, under whatever `bash` they have, and two of them execute code the analyzed repository ships. Portability, the consent boundary and the blocking/fail-soft split are the properties that make the harness safe to leave installed; each one has a shipped regression behind it.

- Write for Bash 3.2 and a BSD userland: no `mapfile`, no associative arrays, no `${var,,}`, and every array expansion guarded under `set -u` as `"${arr[@]+"${arr[@]}"}"`. Prefer `sed -E`/`grep -E` forms that behave identically on BSD and GNU.
- `bash -n` is not sufficient evidence for a shell change. Exercise the behaviour — the `bash32` CI job runs the suite under the real `/bin/bash` 3.2 for exactly this reason, and `tests/init-project.test.mjs` and `tests/stream-progress.test.mjs` drive the generator end to end.
- `verify-project.sh` and `mark-baseline-dirty.sh` may set `VERIFY_ENABLED`, `BASELINE_ENABLED` or `TRACK` to true only from a path under `$STATE_DIR`. An in-repository marker may be reported, never honoured; `tests/consent.test.mjs` scans those assignment lines.
- Preserve the exit-code contract shared with the generated `verify.sh`: 0 passed, 3 no strategy applies, 127 a required command is missing, anything else blocks with exit 2 from the Stop hook.
- `tools/refresh-baseline.sh` deliberately runs under `set -uo pipefail` with no `-e`. Do not add or restore errexit: it would defeat the fail-soft contract and could abort between the paired `.md` and `.json` writes.
- The ignore `case` list in `src/hooks/mark-baseline-dirty.sh` and the `grep -Ev` regex in `tools/refresh-baseline.sh` are mirrors of one decision. Change one and change the other in the same commit.
- `install.sh` and `uninstall.sh` derive every file they touch by walking the payload tree. Never introduce a hardcoded list — it fails in the passing direction, silently never copying a file that was committed, reviewed and documented.
- Under `~/.claude`, only create, prune or remove names matching `harness-*` in `rules/`, `agents/` and `skills/`, plus the two unprefixed pre-namespace names. Those directories belong to the user too.
- Before replacing any user file, back it up under `~/.claude/harness-*-backups/<stamp>/`, then write a temp file and rename over the target. `CLAUDE.md` merging in `init-project.sh` is the one place that still truncates in place — do not copy that pattern into new code.
- Do not restate a release number. Read it from `VERSION` or do not mention it; `tests/version.test.mjs` scans these scripts for a hardcoded `vN`.
- Every scripted `claude` call keeps `--safe-mode --tools "Read,Glob,Grep" --disallowedTools "mcp__*" --permission-mode dontAsk --no-session-persistence --json-schema`.
- Diagnostics go to stderr; stdout belongs to the caller that parses it. A new `.sh` anywhere in the tree is linted automatically because CI derives its file set from `git ls-files '*.sh'` against pinned shellcheck v0.11.0.
- `tools/init-project.sh` is already over 1,200 lines and carries two shipped regressions in its `verify.sh` generation alone. Do not grow it in place: when a section needs changing, extract that section rather than appending beside it.

Evidence used during harness analysis: `install.sh`, `uninstall.sh`, `tools/init-project.sh`, `tools/refresh-baseline.sh`, `src/hooks/verify-project.sh`, `src/hooks/mark-baseline-dirty.sh`, `tests/consent.test.mjs`, `tests/hooks.test.mjs`
