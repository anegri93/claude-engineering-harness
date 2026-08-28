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
