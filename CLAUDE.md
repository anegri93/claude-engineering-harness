# claude-engineering-harness

This repository is the harness itself. It is not an application: it is a payload of shell
scripts, dependency-free Node ESM tools and Markdown instructions that install into a user's
`~/.claude` and then run inside their repositories. A defect here does not break one project,
it breaks every project the harness is installed in — silently, because most of the failure
modes are "a check that never ran" rather than "a check that failed".

The harness does not run against itself for its own generated rules (that would be circular),
so this file is where its constraints live. Read it before the first change of a session.

## Hard constraints

These are not preferences. A change that breaks one of them is wrong even if it works.

**No dependencies.** No `package.json`, no lockfile, no third-party packages. Node tools are
ESM `.mjs` using `node:` builtins only. Shell uses POSIX utilities. The harness installs into
a user's home directory; anything it needs at runtime must already be on their machine.

**Bash 3.2 and a BSD userland.** macOS still ships `/bin/bash` 3.2, and the hooks run under
whatever `bash` the user has. No `mapfile`, no associative arrays, no `${var,,}` in shipped
scripts. Guard every array expansion under `set -u` (`"${arr[@]+"${arr[@]}"}"`) — Bash 3.2
treats an empty array expansion as unbound. Prefer `sed -E`/`grep -E` forms that behave the
same on BSD and GNU. `bash -n` is not sufficient evidence: both known macOS regressions parsed
cleanly and failed at runtime. The `bash32` CI job executes the suite under real 3.2.

**Install and uninstall are one change.** `src/`, `project-template/` and `tools/` are the
installable payload. Both scripts derive what they touch from the tree, never from a list.
`tests/payload.test.mjs` adds a file to every payload directory and proves it installs and
uninstalls; if a new payload directory is introduced, it goes in that test in the same commit.

**`harness-` is the ownership marker.** `rules/`, `agents/` and `skills/` under `~/.claude`
belong to the user too. The harness only ever creates, prunes or removes names matching
`harness-*` there, plus the two unprefixed legacy names it shipped before v6. Generated
project files carry `generated-by: claude-engineering-harness`.

**Never overwrite a user file in place.** Back up under `~/.claude/harness-*-backups/<stamp>/`
first, then write a temp file and rename over the target. An interrupted write must not
truncate. `tests/settings.test.mjs` pins this for `settings.json`.

**Blocking versus fail-soft is a deliberate split.** Verification failure blocks (exit 2 from
the Stop hook). Everything advisory — baseline refresh, environment conditions — reports and
exits 0, leaving its dirty marker for the next Stop. `refresh-baseline.sh` runs *without*
errexit on purpose; do not "restore" it with `set -e`.

**An unavailable tool is an environment condition, not a defect.** Exit `3` (nothing to
verify) and `127` (missing command) are reported with their remediation and do not block.
Anything else means the checks ran and something is wrong, and that blocks. A gate that
misdiagnoses is a gate the user deletes, and then nothing is checked at all.

**Consent to run repository code lives outside the repository.** The hooks are installed
globally and fire in every repository the user opens, including a fresh clone, and two steps
execute repository-shipped scripts (`verify.sh` at Stop, `preflight.sh` at init). Every
enabling decision therefore reads from `~/.claude/harness-runtime/<project>/`, which only
`init-project.sh` writes. Never add a code path that decides whether to run something based on
a file the repository can ship — "did the harness write this file?" is a question about
authorship, not about permission. `tests/consent.test.mjs` pins the boundary.

**Every scripted Claude invocation is read-only.** `--safe-mode --tools "Read,Glob,Grep"
--disallowedTools "mcp__*" --permission-mode dontAsk --no-session-persistence`, with
`--json-schema`. The harness reads repositories; it never lets a scripted call write one.

**Model output is untrusted input.** Any string from a model that reaches a filesystem path,
a glob or a filename goes through `safeRepoPath`/`safeGlob`/`safeSlug` first. Rule *bodies*
are sanitized too: they land in files Claude Code loads as instructions in every session, so
a leading `@` (a file import) and markdown link targets are neutralized.

**Absence is not data.** A dimension that was not measured renders as "not measured", never as
zero and never as a favourable default. If a truncation, a cap or a skipped step changed what
the model saw, say so in the artifact rather than letting a degraded run read like a grounded
one.

## Documentation obligations

- A user-visible change needs a `## Unreleased` entry in `CHANGELOG.md` that names the failure
  it fixes, not just the change.
- `README.md` and `README.es.md` are a mirrored pair. Both move together, in the same commit.
- Comments explain *why*, especially the non-obvious constraint a line is defending against.
  The existing comments are load-bearing; several record a specific incident.

## Verification

Run all of it before calling a change done:

```bash
node --test tests/*.test.mjs
docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.11.0 $(git ls-files '*.sh')
PATH="/bin:$PATH" node --test tests/*.test.mjs   # macOS only: the suite under Bash 3.2
```

A new test must be shown to fail against the unfixed code. A test that passes both before and
after is worse than no test: it reports coverage that does not exist. Two shipped comments
once claimed `tests/hooks.test.mjs` asserted something, for months, while the file did not
exist.

## What is deliberately absent

Do not add these back without a concrete reason:

- A plugin/marketplace manifest. The harness ships a `~/.claude/CLAUDE.md` import line and
  `settings.json` hook wiring, neither of which a plugin can own.
- An `docs/adr/` corpus. Decisions are recorded at the point of code and in the CHANGELOG.
- A diff-scoped CI gate. This repo pushes directly to `main`, so `github.base_ref` is empty
  and such a gate would run zero times. Invariants here are properties of the tree.
- Byte-exact golden fixtures over prose-heavy renderer output. They train regeneration
  without reading.


<!-- CLAUDE-ENGINEERING-HARNESS:BEGIN -->
# Project Engineering Context

This repository uses the global Claude Engineering Harness. Repository-specific facts below were derived from a read-only codebase analysis. Preserve existing architecture unless a requested change intentionally alters it.

## Project

- Name: claude-engineering-harness
- Kind: Node.js
- Stack: Node.js (no package manager)
- Package manager: Not detected
- Monorepo: false

## System summary

`claude-engineering-harness` is not an application but a personal Claude Code harness: a payload of Bash scripts, dependency-free Node ESM tools and Markdown instructions that `install.sh` copies into `~/.claude` and that `tools/init-project.sh` then wires into individual repositories. Globally it installs a fixed engineering standard (`src/harness/engineering.md`) as a `~/.claude/CLAUDE.md` import, two Claude Code hooks (a PostToolUse edit recorder and a Stop verification gate), path-scoped rules under `src/rules/`, a review skill and a read-only reviewer agent. Per project it wires Graft, runs a read-only Opus 5 analysis against a closed JSON schema, renders the result into `.claude/rules/`, a managed `CLAUDE.md` block and a living `engineering-baseline.md`/`.json`, generates `.claude/verify.sh` and `.claude/preflight.sh` from the detected stack, and enables the Stop gate only after that project's verification was observed to pass once. The repository has no `package.json`, no lockfile and no dependencies; it verifies itself with `node --test tests/*.test.mjs` plus a pinned shellcheck, on Linux and macOS across Node 20/22/24 and once under real Bash 3.2.

## Architecture

Four layers with deliberately little overlap (README.md "Boundary"): Claude Code owns the runtime, Graft owns the repository map, this harness owns engineering policy and the verification gate, and the user's repository owns the code and the scripts that verify it. Dependency direction inside the repository is one-way and shallow: `install.sh`/`uninstall.sh` walk the payload trees (`src/`, `project-template/`, `tools/`) and copy them into `~/.claude`; the shipped hooks in `src/hooks/` invoke `tools/refresh-baseline.sh` only through its installed copy at `$HOME/.claude/harness-tools/`; the shell scripts drive the `claude` CLI and hand its JSON to the Node renderers in `tools/*.mjs`, which are pure file-in/file-out processes with no shell knowledge and no cross-imports except `tools/settings-io.mjs`, shared by `merge-settings.mjs` and `remove-settings-hook.mjs`. Two boundaries are load-bearing and asymmetric: consent to execute repository-shipped scripts is read only from `~/.claude/harness-runtime/<project>/` and never from the repository, and verification failure blocks with exit 2 while everything advisory — baseline refresh, environment conditions — reports and exits 0, keeping its dirty marker for the next Stop.

## Key boundaries

- `install.sh`: Global installer. Walks every payload directory rather than a list, prunes the `harness-*` namespace under `rules/`, `agents/` and `skills/` before reinstalling, backs each target up under `~/.claude/harness-backups/<stamp>/`, derives the executable bit from the source file, appends the `engineering.md` import to `~/.claude/CLAUDE.md`, and delegates settings to `merge-settings.mjs`. Ensures/upgrades the Graft CLI first and exits 127 without npm.
- `uninstall.sh`: The exact inverse, derived from the same tree. Restores `settings.json` first — before deleting anything — because that step can fail for an environment reason and the helper it needs lives inside the directory the removal wipes; then removes only the `harness-*` namespace, the hooks derived from `src/hooks/`, and the three harness-owned directories.
- `tools/init-project.sh`: Per-repository bootstrap: resolves the project root, refuses to initialize inside `~/.claude`, detects stack/package manager/scripts, wires Graft and gathers structural evidence, runs the read-only Opus 5 analysis through `stream-progress.mjs`, calls the renderer, merges the managed CLAUDE.md block, decides preflight trust, synthesizes `verify.sh` per stack with the spliced hadolint block, runs preflight plus baseline verification, and writes the Stop-gate markers only if verification passed.
- `src/hooks/verify-project.sh`: The Stop gate. Reads consent from `~/.claude/harness-runtime/<project>/`, decides whether the session changed anything from git plus the PostToolUse edit record, runs `.claude/verify.sh`, blocks with exit 2 on a genuine failure, reports exit 3 / 127 as environment conditions, then invokes the fail-soft baseline refresh and clears the edit record when the refresh is off.
- `src/hooks/mark-baseline-dirty.sh`: PostToolUse edit recorder. Calls no model. Normalizes the edited path against the physical project root so a symlinked ancestor does not discard the edit, filters harness bookkeeping and build output through a `case` list mirrored in `refresh-baseline.sh`, and appends to `changed-files.txt` only when a gate is enabled from the user's state directory.
- `tools/refresh-baseline.sh`: Incremental living-baseline refresh. Deliberately runs under `set -uo pipefail` without errexit so every failure stays fail-soft and the dirty marker survives for the next Stop; re-filters the changed set defensively, adds Graft change-impact context (distinguishing 'not installed' from 'returned nothing'), calls Claude with a JSON schema, and writes only when the render reports a semantic change.
- `tools/render-project-analysis.mjs`: Turns the model's structured analysis into the CLAUDE.md managed block, `rules/project-architecture.md`, the `harness-*.md` rule files and the initial baseline pair. Owns every sanitizer for model-supplied paths, globs, filenames and rule bodies, the `harness-` prefix stripping, and the scope-based rule-name reuse that keeps re-initialization an edit rather than a rename.
- `tools/render-baseline-refresh.mjs`: Applies finding reviews and new findings to the persisted baseline: stable `F###` identity from a persisted counter, title-normalized deduplication, severity-ordered retention caps (20 active / 15 archived) and a semantic-diff check so an unchanged refresh writes nothing.
- `tools/settings-io.mjs`: The only shared Node module. Holds `HARNESS_DEFAULTS` (the single source of the model/effort defaults), the `~/.claude` path helpers including `statePath()` kept outside the directory uninstall deletes, and `writeJsonFileAtomic`, which writes a sibling temp file and renames over the target so an interrupted write cannot truncate a user's settings.
- `tools/merge-settings.mjs`: Installs the two hooks and the defaults into `~/.claude/settings.json` idempotently, records the pre-install `model`/`effortLevel` once into `harness-state.json` so a repeat install cannot overwrite what uninstall must restore, and leaves unrelated settings and foreign hooks untouched.

## Repository-specific rules

- No dependencies, ever: no `package.json`, no lockfile, no third-party packages. Node tools are ESM `.mjs` using `node:` builtins only; shell uses POSIX utilities. Anything needed at runtime must already be on the user's machine.
- Target Bash 3.2 and a BSD userland in every shipped script: no `mapfile`, no associative arrays, no `${var,,}`, and guard array expansion under `set -u` with `"${arr[@]+"${arr[@]}"}"`. `bash -n` is not evidence — both known macOS regressions parsed cleanly and failed at runtime.
- Install and uninstall are one change. `src/`, `project-template/` and `tools/` are the payload; both scripts derive what they touch from the tree, never from a list. A new payload directory goes into `tests/payload.test.mjs` in the same commit.
- `harness-` is the ownership marker. Under `~/.claude`, only names matching `harness-*` in `rules/`, `agents/` and `skills/` may be created, pruned or removed — those directories belong to the user too. Generated project files carry `generated-by: claude-engineering-harness`.
- Never overwrite a user file in place. Back it up under `~/.claude/harness-*-backups/<stamp>/`, then write a temp file and rename over the target so an interrupted write cannot truncate anything.
- Consent to run repository-shipped code lives outside the repository. Every enabling decision reads from `~/.claude/harness-runtime/<project>/`, written only by `init-project.sh`. Never add a code path that decides whether to execute something based on a file the repository can ship.
- Blocking versus fail-soft is a deliberate split: verification failure blocks with exit 2; baseline refresh and environment conditions report and exit 0, leaving the dirty marker for the next Stop. `tools/refresh-baseline.sh` runs without errexit on purpose — do not "restore" `set -e`.
- An unavailable tool is an environment condition, not a defect. Exit `3` (nothing to verify) and `127` (missing command) are reported with their remediation and never block; every other nonzero exit means the checks ran and something is wrong.
- Every scripted Claude invocation is read-only and non-persistent: `--safe-mode --tools "Read,Glob,Grep" --disallowedTools "mcp__*" --permission-mode dontAsk --no-session-persistence`, with `--json-schema`. The harness reads repositories; it never lets a scripted call write one.
- Model output is untrusted input. Any string reaching a filesystem path, glob or filename goes through `safeRepoPath`/`safeGlob`/`safeSlug`; rule bodies go through `safeRuleText`, because they land in files Claude Code loads as instructions in every future session.
- Absence is not data. A dimension that was not measured renders as "not measured", never as zero or a favourable default, and a truncation, cap or skipped step is stated in the artifact so a degraded run cannot read like a grounded one.
- Documentation moves with the code: a user-visible change needs a `## Unreleased` entry in `CHANGELOG.md` naming the failure it fixes, and `README.md` and `README.es.md` are a mirrored pair that change in the same commit.

## Business invariants

- The Stop gate and the living-baseline refresh are enabled for a project only after `init-project.sh` observed that project's verification pass once, and the markers live in `~/.claude/harness-runtime/<project>/` where no repository can write them. A previous grant is revoked at the start of every rerun and must be re-earned.
- A `.claude/preflight.sh` the harness did not generate is preserved byte-for-byte but not executed: its executable bit is cleared until approved with `--trust-preflight`, and the approval records that exact file's SHA-256, so a later edit or `git pull` withdraws it.
- Baseline findings keep stable `F###` identity across refreshes. New IDs come from the persisted `next_finding_id` counter, never from the current maximum, so an ID freed by the retention cap is never handed to a different finding.
- The living baseline is capped at 20 active and 15 resolved/stale findings, dropping the lowest severity first and oldest-first within a severity, and pruning is reported rather than silent.
- A rule group is identified across re-initializations by the area its `paths:` cover — equal, subset or superset after `**` segments are dropped — not by the filename the model returns, so a rerun edits an existing `harness-*.md` instead of renaming it. The frontmatter still records the glob exactly as the model wrote it, because there the depth is the meaning.
- The `harness-` prefix is added by the renderer and is never part of the topic: any prefix the model supplied is stripped first, so re-initialization cannot produce `harness-harness-<topic>`.
- The ignore list in the `case` statement of `src/hooks/mark-baseline-dirty.sh` and the `grep -Ev` regex in `tools/refresh-baseline.sh` must make the same call on every path; they are a deliberate duplication with a test that compares them decision by decision.
- `VERSION` is the single source of the release string: it must be a bare semantic version, must equal the newest released `CHANGELOG.md` heading, is installed to `~/.claude/harness/VERSION`, and no shipped script may restate a release number in prose.

## Commands

- Install: `Not detected`
- Development: `Not detected`
- Lint: `Not detected`
- Typecheck: `Not detected`
- Test: `Not detected`
- Build: `Not detected`
- Verification gate: `.claude/verify.sh`

Detailed conditional rules live under `.claude/rules/`. The living engineering baseline is available at `.claude/engineering-baseline.md` and is refreshed automatically after verified Claude Code edits.
<!-- CLAUDE-ENGINEERING-HARNESS:END -->
