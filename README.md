# Claude Engineering Harness

[English](README.md) · [Español](README.es.md)

### Your coding agent stops guessing, stops forgetting, and stops saying "done" without proof.

`claude-engineering-harness` is a personal Claude Code harness. It installs a fixed engineering standard into every session, generates rules from a semantic read of your actual repository, gates the end of every task on verification that really ran, and keeps a baseline of known risks that ages with the code instead of going stale.

Personal tooling, built for my own projects. It installs globally into `~/.claude` and initializes per repository.

---

## Contents

- [Quick start](#quick-start)
- [The problem](#the-problem)
- [What the harness does](#what-the-harness-does)
- [The engineering standard](#the-engineering-standard)
- [What runs when](#what-runs-when)
- [What each generated file is for](#what-each-generated-file-is-for)
- [What verification actually runs](#what-verification-actually-runs)
- [Starting a new project](#starting-a-new-project)
- [Tests](#tests)
- [Baseline states](#baseline-states)
- [Graft and the harness](#graft-and-the-harness)
- [Cost](#cost)
- [Backups](#backups)
- [Uninstall](#uninstall)

---

## Quick start

```bash
chmod +x install.sh
./install.sh                              # global standard, hooks, skill, agent
~/.claude/harness-tools/init-project.sh   # from inside any repo you want covered
```

That is the whole setup. `install.sh` writes the standard into `~/.claude` and wires two hooks into your Claude Code settings. `init-project.sh` reads the repository, writes rules specific to it, generates the baseline and the verification script, and switches the Stop gate on once it has proven verification works. From the next session on, the harness rides along.

Restart Claude Code after installing. Rerun `init-project.sh` after upgrading the harness — it regenerates the project files and keeps the existing baseline state.

Needs Node 20+ and npm for Graft. Git is optional — outside a repository the initializer uses the current directory as the project root. Nothing is clobbered: the installer preserves unrelated Claude Code configuration and backs up every file it touches under `~/.claude/harness-backups/<timestamp>/`.

---

## The problem

Your agent finishes a task and tells you it is done. The lint never ran. The test suite never ran. The summary is confident, the diff is plausible, and nothing checked it. You find out later.

Underneath that, three more things go wrong every session:

- **Blind.** It re-explores the repo from zero, one grep and one file at a time, rebuilding a picture it had an hour ago and threw away.
- **Forgetful.** A risk found on Tuesday is gone by Wednesday. Nothing carries across sessions, so the same weak spot gets rediscovered or silently reintroduced.
- **Disabled.** Docker was down, so the tests "failed", so the verification gate became noise, so you turned it off. Now nothing is checked at all.

A senior engineer holds a standard, remembers what is fragile, and does not claim a check they skipped. The harness makes the agent do the same, mechanically, instead of hoping.

---

## What the harness does

- **A fixed standard, every session.** One engineering policy loaded into every repository, with an explicit priority order for tradeoffs and an explicit rule against claiming unverified work is verified.
- **Rules from your code, not from a template.** `init-project.sh` runs a read-only semantic analysis of the repository with Opus 5 and writes `.claude/rules/` describing this codebase's architecture, boundaries and invariants.
- **A gate that cannot be talked past.** The Stop hook runs format, lint, types, tests and build before the task can end. Failure blocks.
- **The environment gets started, not blamed.** Before anything is called broken, a preflight brings up Docker and Supabase and waits. A stopped container is not a failing test.
- **Findings that survive the session.** Risks get stable IDs and are revalidated when a change could plausibly have touched them. Fixed ones flip to `[RESOLVED]`, obsolete ones to `[STALE]`.
- **A second opinion on demand.** A review skill and an independent reviewer agent, both read-only, for production-readiness passes.

---

## The engineering standard

The core of the harness is `~/.claude/harness/engineering.md`, loaded into every session. It is opinionated on purpose.

When tradeoffs exist, it fixes the order:

```text
1. Correctness
2. Security and data integrity
3. Maintainability
4. Simplicity
5. Consistency with the existing architecture
6. Performance when supported by evidence
```

Performance sits last deliberately. It gets optimized when measured, not when suspected.

The rest of the standard is what a reviewer would ask for anyway:

| Rule | What it demands |
|---|---|
| **Understand before changing** | Read the implementation. Identify callers, dependencies, side effects. Never implement from a filename or an assumption. |
| **Design for failure** | Invalid input, stale data, timeouts, partial failures, duplicate operations, retries, concurrency, interrupted operations. Never swallow an error in silence. |
| **Untrusted input** | Validate at boundaries. Authentication is not authorization. Parameterize queries. Never log credentials. Sanitize errors that cross a trust boundary. |
| **Hold scope** | No unrelated refactors. No speculative abstractions. No redesigning working architecture without a concrete reason. |
| **Test risk, not shape** | Cover business rules, edge cases, failure paths, regressions, concurrency. Never weaken a valid test to make a change pass. |
| **Finish honestly** | Inspect the final diff, run format, lint, types, tests and build, then review the diff as if approving someone else's work for production. If a step could not run, say exactly what was not verified and why. |

That last row is the one the Stop gate enforces mechanically rather than trusting.

The installer also pins the model and effort this work runs at:

```text
Model:  claude-opus-5
Effort: high
```

---

## What runs when

Four things fire on their own. Nothing else needs running by hand.

```text
Claude edits a file
      ↓  PostToolUse hook · no model call
records which files the task touched
      ↓
Claude finishes the task
      ↓  Stop hook
preflight  →  starts Docker / Supabase if they are down
      ↓
verify     →  format · lint · types · tests · build · Dockerfile
      ↓  blocks on failure
refresh    →  Opus 5 revalidates only the findings the change could reach
      ↓  fail-soft
engineering-baseline.md updated only if something changed
```

**PostToolUse** fires on `Write`, `Edit`, `MultiEdit` and `NotebookEdit`, and records repository-relative paths into `~/.claude/harness-runtime/<project>/`. It calls no model and touches no code. It exists so the refresh knows the blast radius without guessing. It ignores its own bookkeeping — edits to the baseline files, to `.claude/rules/`, to `verify.sh`, and to `graft/`, `node_modules/`, `dist/`, `build/` and `coverage/` never mark the project dirty.

**The Stop hook** runs verify first and refresh second, and the order is the point. Verification failure blocks the task. Refresh failure is fail-soft: it never turns a good change into a failed task, and the dirty state is kept so the next Stop retries.

**The preflight** checks whether Docker is installed but stopped, whether `supabase/config.toml` exists with the stack down, and whether the repo genuinely references Docker Compose. Both waits are bounded and overridable:

```bash
HARNESS_DOCKER_WAIT_SECONDS=120
HARNESS_SUPABASE_WAIT_SECONDS=180
HARNESS_AUTO_INFRA=0 .claude/verify.sh   # check only, start nothing
```

It never resets or deletes a local database to recover from a failed start. It stops and reports the environment problem instead.

**The refresh** hands Opus 5 the current structured baseline plus Graft's change-impact context, restricted to `Read`, `Glob` and `Grep`. It cannot edit. It is asked for two things and nothing else: revalidate findings the change could plausibly have affected, and flag concrete new risks inside the blast radius.

---

## What each generated file is for

### In your repository

Written by `init-project.sh`, except where noted.

| File | What it is |
|---|---|
| `CLAUDE.md` | Your project instructions. The harness updates only its own managed block and preserves everything else you wrote. |
| `.claude/rules/project-architecture.md` | The architecture profile Opus wrote after reading your repository: modules, boundaries, data flow, invariants. This is the file that makes advice specific instead of generic. |
| `.claude/rules/harness-*.md` | Conditional rules that load only for matching paths. Backend integrity, security boundaries, testing strategy, and whatever else the analysis judged this repo needs. |
| `.claude/engineering-baseline.md` | The human-readable list of known engineering risks, each with a stable ID and a state. This is the file you read. |
| `.claude/engineering-baseline.json` | The same findings as machine state. It exists so a finding keeps its identity across refreshes instead of being rewritten as a new one every time. |
| `.claude/verify.sh` | The verification command for this project, generated from the stack it detected. Edit it freely — it is yours. |
| `.claude/preflight.sh` | Brings up local infrastructure before verification judges anything. Generated only if you do not already have one; a custom preflight is never overwritten. |
| `.claude/verify-on-stop` | An empty marker file. Its presence is what enables the Stop verification gate. Delete it to turn the gate off for this repo. |
| `.claude/baseline-refresh-on-stop` | The same idea for the baseline refresh. Both markers are written only after that step was proven to work once, so a repo where verification cannot run never gets a gate that fails forever. |
| `.claude/auto-compose` | Optional, created by you. Its presence tells the preflight to bring up Docker Compose in a repo that does not otherwise reference it. |
| `.claude/settings.json` | Project-level Claude Code settings. |
| `.mcp.json`, `.claude/skills/graft/`, `.claude/helpers/` | Written by `graft init`, not by the harness. The harness backs them up first, then lets Graft own them. |

### Global, in `~/.claude`

| File | What it is |
|---|---|
| `harness/engineering.md` | The engineering standard itself. The single most important file in the repo. |
| `harness/project-analysis-prompt.md` + `.json` | The prompt and JSON schema for the initial repository analysis. The schema is what forces structured output instead of prose. |
| `harness/baseline-refresh-prompt.md` + `.json` | The same pair for the incremental refresh. |
| `harness/project-template/` | The `CLAUDE.md`, `verify.sh`, `preflight.sh` and architecture-rule skeletons that `init-project.sh` copies and fills in. |
| `rules/harness-*.md` | Rules that load automatically for matching file paths in any project: `typescript`, `react`, `tests`, `sql`, `http-api`, `jobs`, `config`, `shell`, `docker`, `ci`. Each declares its own path globs, so nothing loads where it does not apply. |
| `skills/engineering-review/SKILL.md` | The review skill: a production-readiness pass over correctness, security, maintainability, scalability and test quality. |
| `agents/engineering-code-reviewer.md` | A read-only reviewer agent that cannot edit, for an independent second opinion on a finished change. |
| `hooks/mark-baseline-dirty.sh` | The PostToolUse hook. Records edited files, calls no model. |
| `hooks/verify-project.sh` | The Stop hook. Runs preflight, verification, then refresh. |
| `harness-tools/` | `init-project.sh` and `refresh-baseline.sh`, plus the renderers that turn structured model output into Markdown, and the settings helpers used by install and uninstall. |
| `harness-runtime/<project>/` | Per-project dirty state written by the PostToolUse hook and consumed by the refresh. Disposable. |
| `harness-state.json` | The `model` and `effortLevel` your `settings.json` had before the first install, so uninstall can put them back. Written once, never overwritten by a repeat install, deleted by uninstall. |

---

## What verification actually runs

`init-project.sh` writes `.claude/verify.sh` from the stack it finds:

| Detected | What the generated script runs |
|---|---|
| `package.json` | Your real scripts, through the package manager from your lockfile. A pnpm monorepo falls back to `pnpm -r --if-present run` over lint, typecheck, test and build. |
| Python | `ruff check`, `mypy`, `pytest` — whichever are installed. |
| `go.mod` | `go vet ./...`, `go test ./...` |
| `Cargo.toml` | `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test` |
| none of those | A stub that exits 3 and asks you to customize it, rather than pretending to verify. |

Independently of the stack, a repository containing a `Dockerfile` also gets linted with hadolint before the stack checks run. Two decisions keep that gate usable rather than annoying:

- **A missing hadolint reports and continues.** An unavailable tool is not a code defect, and failing the build over it is how a gate gets switched off.
- **It fails at `warning` and above, not at hadolint's default of `info`.** The default fails a perfectly correct Dockerfile over advisory notes. Warnings still catch what matters — a `latest` base image, unpinned apt versions. Override with `HARNESS_HADOLINT_THRESHOLD`.

For a Node project it runs the strongest checks you already have, cheapest and non-mutating first, stopping at the first failure:

```text
fmt:check       formatting
format:check    formatting, alternate script name
lint            static analysis
typecheck       falls back to test:types
test            your suite
build           last, most expensive
```

Every one of those is skipped when `package.json` has no such script. Nothing is invented and nothing is guessed. A project with only `lint` and `test` runs exactly those two.

When nothing can be detected, the stub fails loudly instead of passing. That is deliberate. Silently verifying nothing is worse than saying it cannot.

---

## Starting a new project

`init-project.sh` analyzes a repository and gates on verifying it, so it needs something to analyze. On an empty directory it degrades honestly rather than pretending:

1. Graft builds a near-empty graph, and the semantic analysis has almost nothing to describe.
2. No stack is detected, so `verify.sh` is the stub that exits 3.
3. Verification fails, so **neither marker is written** — the Stop gate and the living baseline both stay off.
4. The initializer exits non-zero, telling you exactly that.

That is the design working. A repository where verification cannot pass never gets a gate that would fail on every task.

**You do not need any of that to start.** The standard, the language rules, the review skill and the reviewer agent are global: `install.sh` puts them in `~/.claude` and they apply to every session in every directory, initialized or not. A brand-new project already gets the engineering standard from the first prompt.

The sequence that works:

```bash
./install.sh                              # once, ever
# ... scaffold the project: package.json, scripts, one passing test ...
git init && git add -A && git commit -m "initial"
~/.claude/harness-tools/init-project.sh   # now there is something to analyze
```

Run it once the project has a `test` or `lint` script that passes and enough code to describe. Before that point the project layer has nothing to say, and the global layer is already covering you.

If you want the project files in place early anyway, `--skip-verify` configures everything and leaves the gates off by design. Rerun without it once the project can verify itself.

---

## Tests

Two different things share the word, so worth being exact.

**In your repository, the harness runs tests. It does not write them.** Verification executes your existing `test` script through your package manager. It does not generate tests, does not invent a test command, and does not treat your suite as optional. No `test` script means that step is skipped and the rest still run.

What the harness contributes is policy. When Claude writes tests under `**/*.test.*`, `**/*.spec.*`, `**/test/**` or `**/tests/**`, these load automatically:

- Test externally meaningful behavior and invariants, not implementation details.
- Keep tests deterministic and independent of execution order.
- Avoid arbitrary sleeps and timing-sensitive assertions where deterministic synchronization is possible.
- Name each test after the behavior or risk it protects.
- A regression test must fail for the original bug and pass for the fix.
- Do not mock the unit under test. Mock external boundaries only when it improves determinism without hiding the behavior being validated.
- Never weaken or delete a valid test to make a change pass.

**This repository has its own tests.** The scripts that edit `~/.claude/settings.json` are covered by round-trip tests that run them as real subprocesses against a throwaway `HOME`, because the risk they carry is what they do to a real config file on disk. Nothing but Node 20+ required:

```bash
node --test tests/*.test.mjs
```

CI runs them on Node 20, 22 and 24 and lints every shell script with a pinned shellcheck.

---

## Baseline states

Findings get stable IDs — `F001`, `F002`, `F003` — and a state that moves as the code does:

```text
[OPEN]     finding still exists
[CHANGED]  partly fixed or narrowed
[RESOLVED] current source and tests show it is fixed
[STALE]    the old claim is no longer supportable
[NEW]      a concrete risk introduced or found in changed scope
```

```text
Before
[OPEN] HIGH — Health endpoint returns 200 while degraded · F001

After a verified fix
[RESOLVED] HIGH — Health endpoint returns 200 while degraded · F001
```

The baseline is advisory, not authoritative. The standard tells Claude to verify a finding against current source and tests before acting on it, because a finding written three weeks ago may already be fixed.

Refresh maintains findings, not the architecture model. If Opus decides a task materially changed the architecture, the baseline records `Full harness reanalysis recommended` and you rerun `init-project.sh`. That split is why an ordinary feature never pays for a full repository analysis.

---

## Graft and the harness

Two layers, no overlap:

```text
Graft                        Harness
  repository map               engineering policy
  symbols                      project-specific rules
  callers                      business invariants
  relationships                living findings
  blast radius                 verification
  freshness
```

Graft answers *where things are and what they touch*. The harness decides *what good looks like and whether you are done*. Claude Code uses both.

Graft evidence accelerates navigation. Critical security, correctness, business-rule and mutation decisions still get verified against source — the standard says so explicitly.

On install and on project init, the harness asks npm whether there is a newer Graft and upgrades only when the registry is ahead. It will not downgrade a local build that is newer than npm latest.

---

## Cost

`init-project.sh` is the expensive call. It reads the repository deeply, once.

After that, at most one incremental baseline analysis per coding task, and only when the task actually edited relevant files. Several edits in one task collapse into a single refresh. A task that edited nothing relevant makes no model call at all.

---

## Backups

Nothing is overwritten without a copy first.

```text
~/.claude/harness-backups/            global installation
~/.claude/harness-project-backups/    project initialization
~/.claude/harness-baseline-backups/   living-baseline updates
~/.claude/harness-project-analysis/   structured analysis archives
```

---

## Uninstall

```bash
./uninstall.sh
```

Removes the harness's own global files and hooks, and restores the model and effort settings you had before the first install. Backup directories are preserved. Graft is left installed.

---

## License

MIT. See [LICENSE](LICENSE).
