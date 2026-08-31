<!-- generated-by: claude-engineering-harness -->
# Project Architecture

Four layers with deliberately little overlap (README.md "Boundary"): Claude Code owns the runtime, Graft owns the repository map, this harness owns engineering policy and the verification gate, and the user's repository owns the code and the scripts that verify it. Dependency direction inside the repository is one-way and shallow: `install.sh`/`uninstall.sh` walk the payload trees (`src/`, `project-template/`, `tools/`) and copy them into `~/.claude`; the shipped hooks in `src/hooks/` invoke `tools/refresh-baseline.sh` only through its installed copy at `$HOME/.claude/harness-tools/`; the shell scripts drive the `claude` CLI and hand its JSON to the Node renderers in `tools/*.mjs`, which are pure file-in/file-out processes with no shell knowledge and no cross-imports except `tools/settings-io.mjs`, shared by `merge-settings.mjs` and `remove-settings-hook.mjs`. Two boundaries are load-bearing and asymmetric: consent to execute repository-shipped scripts is read only from `~/.claude/harness-runtime/<project>/` and never from the repository, and verification failure blocks with exit 2 while everything advisory — baseline refresh, environment conditions — reports and exits 0, keeping its dirty marker for the next Stop.

## Module responsibilities

### `install.sh`

Global installer. Walks every payload directory rather than a list, prunes the `harness-*` namespace under `rules/`, `agents/` and `skills/` before reinstalling, backs each target up under `~/.claude/harness-backups/<stamp>/`, derives the executable bit from the source file, appends the `engineering.md` import to `~/.claude/CLAUDE.md`, and delegates settings to `merge-settings.mjs`. Ensures/upgrades the Graft CLI first and exits 127 without npm.
- Depends on: `tools/settings-io.mjs`, `tools/merge-settings.mjs`, `VERSION`
- Evidence: `install.sh`, `tests/payload.test.mjs`, `tests/version.test.mjs`

### `uninstall.sh`

The exact inverse, derived from the same tree. Restores `settings.json` first — before deleting anything — because that step can fail for an environment reason and the helper it needs lives inside the directory the removal wipes; then removes only the `harness-*` namespace, the hooks derived from `src/hooks/`, and the three harness-owned directories.
- Depends on: `tools/remove-settings-hook.mjs`, `src/hooks`
- Evidence: `uninstall.sh`, `tests/payload.test.mjs`

### `tools/init-project.sh`

Per-repository bootstrap: resolves the project root, refuses to initialize inside `~/.claude`, detects stack/package manager/scripts, wires Graft and gathers structural evidence, runs the read-only Opus 5 analysis through `stream-progress.mjs`, calls the renderer, merges the managed CLAUDE.md block, decides preflight trust, synthesizes `verify.sh` per stack with the spliced hadolint block, runs preflight plus baseline verification, and writes the Stop-gate markers only if verification passed.
- Depends on: `tools/render-project-analysis.mjs`, `tools/stream-progress.mjs`, `project-template/.claude/preflight.sh`, `src/harness/project-analysis-schema.json`
- Evidence: `tools/init-project.sh`, `tests/init-project.test.mjs`, `tests/graft-evidence.test.mjs`, `tests/consent.test.mjs`

### `src/hooks/verify-project.sh`

The Stop gate. Reads consent from `~/.claude/harness-runtime/<project>/`, decides whether the session changed anything from git plus the PostToolUse edit record, runs `.claude/verify.sh`, blocks with exit 2 on a genuine failure, reports exit 3 / 127 as environment conditions, then invokes the fail-soft baseline refresh and clears the edit record when the refresh is off.
- Depends on: `tools/refresh-baseline.sh`
- Evidence: `src/hooks/verify-project.sh`, `tests/hooks.test.mjs`, `tests/consent.test.mjs`

### `src/hooks/mark-baseline-dirty.sh`

PostToolUse edit recorder. Calls no model. Normalizes the edited path against the physical project root so a symlinked ancestor does not discard the edit, filters harness bookkeeping and build output through a `case` list mirrored in `refresh-baseline.sh`, and appends to `changed-files.txt` only when a gate is enabled from the user's state directory.
- Evidence: `src/hooks/mark-baseline-dirty.sh`, `tests/hooks.test.mjs`

### `tools/refresh-baseline.sh`

Incremental living-baseline refresh. Deliberately runs under `set -uo pipefail` without errexit so every failure stays fail-soft and the dirty marker survives for the next Stop; re-filters the changed set defensively, adds Graft change-impact context (distinguishing 'not installed' from 'returned nothing'), calls Claude with a JSON schema, and writes only when the render reports a semantic change.
- Depends on: `tools/render-baseline-refresh.mjs`, `src/harness/baseline-refresh-schema.json`
- Evidence: `tools/refresh-baseline.sh`, `tests/graft-evidence.test.mjs`, `tests/hooks.test.mjs`

### `tools/render-project-analysis.mjs`

Turns the model's structured analysis into the CLAUDE.md managed block, `rules/project-architecture.md`, the `harness-*.md` rule files and the initial baseline pair. Owns every sanitizer for model-supplied paths, globs, filenames and rule bodies, the `harness-` prefix stripping, and the scope-based rule-name reuse that keeps re-initialization an edit rather than a rename.
- Evidence: `tools/render-project-analysis.mjs`, `tests/render.test.mjs`, `src/harness/project-analysis-schema.json`

### `tools/render-baseline-refresh.mjs`

Applies finding reviews and new findings to the persisted baseline: stable `F###` identity from a persisted counter, title-normalized deduplication, severity-ordered retention caps (20 active / 15 archived) and a semantic-diff check so an unchanged refresh writes nothing.
- Evidence: `tools/render-baseline-refresh.mjs`, `tests/render.test.mjs`

### `tools/settings-io.mjs`

The only shared Node module. Holds `HARNESS_DEFAULTS` (the single source of the model/effort defaults), the `~/.claude` path helpers including `statePath()` kept outside the directory uninstall deletes, and `writeJsonFileAtomic`, which writes a sibling temp file and renames over the target so an interrupted write cannot truncate a user's settings.
- Evidence: `tools/settings-io.mjs`, `tests/defaults.test.mjs`

### `tools/merge-settings.mjs`

Installs the two hooks and the defaults into `~/.claude/settings.json` idempotently, records the pre-install `model`/`effortLevel` once into `harness-state.json` so a repeat install cannot overwrite what uninstall must restore, and leaves unrelated settings and foreign hooks untouched.
- Depends on: `tools/settings-io.mjs`
- Evidence: `tools/merge-settings.mjs`, `tools/remove-settings-hook.mjs`, `tests/defaults.test.mjs`

### `tools/stream-progress.mjs`

Stands between the streamed `claude --output-format stream-json` run and the renderers. Repaints progress on stderr only, mirrors the raw NDJSON for diagnostics, strips control characters from model-authored text before it reaches a terminal, and writes the final `result` event byte-compatible with `--output-format json`; a stream that ends without one is an error, not a partial analysis.
- Evidence: `tools/stream-progress.mjs`, `tests/stream-progress.test.mjs`

### `project-template/.claude/preflight.sh`

The generated local-infrastructure preflight copied into user repositories. Bounded, overridable waits for Docker and Supabase; never resets or deletes a local database to recover from a failed start; records what it started through `HARNESS_INFRA_STARTED_FILE` or announces out loud that it left the stack up, with the command that stops it.
- Evidence: `project-template/.claude/preflight.sh`, `tests/init-project.test.mjs`

## Guardrails

- Preserve the dependency direction and responsibilities documented above when extending existing modules.
- Inspect the public API and nearby callers before introducing a cross-boundary dependency.
- If implementation evidence conflicts with this generated description, prefer current code and refresh the harness analysis.
