# Claude Engineering Harness

[English](README.md) · [Español](README.es.md)

Turns Claude Code from an assistant that writes plausible code into one that works to a fixed engineering standard, knows your repository, and cannot call a change done until the checks actually pass.

Personal tooling, built for my own projects. Installs globally into `~/.claude` and initializes per repository.

## Why this exists

A coding agent left to its own devices has four recurring failure modes. Each layer of this harness exists to close one of them.

**It says "done" without proof.** The agent finishes, summarizes confidently, and the lint or the test suite was never run. The harness gates the end of every task on real verification, and forbids claiming a check was run when it wasn't.

**It rediscovers the repository every session.** Broad, shallow exploration, one file at a time, paying for the same orientation over and over. The harness makes Graft the standard context layer, so the agent starts from a repository map and a blast radius instead of a guess.

**It forgets what is already known to be wrong.** Risks found in one session are gone by the next. The harness keeps a living baseline of findings with stable IDs, and revalidates the ones a change could plausibly have affected.

**Verification gets disabled the moment it is inconvenient.** Local infrastructure is down, the tests "fail", and the gate becomes noise to be turned off. The harness distinguishes a broken environment from broken code, and starts the environment itself before deciding anything is broken.

## What you get

- A permanent engineering standard applied to every change, with an explicit priority order for tradeoffs.
- Repository-specific rules generated from a semantic analysis of your actual code, not generic advice.
- A verification gate on task completion: format, lint, types, tests, build.
- Automatic startup of local infrastructure before verification decides anything failed.
- A living baseline of engineering findings that ages and updates instead of going stale.
- A review skill and an independent reviewer agent for production-readiness passes.

## Quick start

Install globally:

```bash
chmod +x install.sh
./install.sh
```

Restart Claude Code, then from anywhere inside a repository you want covered:

```bash
~/.claude/harness-tools/init-project.sh
```

That analyzes the repository, writes `.claude/rules/`, generates the baseline and the verification script, and turns on the Stop gate once verification passes. From then on it is automatic.

Requires Node 20+, Git, and npm for Graft. The installer preserves unrelated Claude Code configuration and backs up every file it touches under `~/.claude/harness-backups/<timestamp>/`.

Rerun `init-project.sh` after upgrading the harness. It regenerates the project files and keeps the existing living baseline state.

## The engineering standard

The core of the harness is a standard loaded into every session. It is opinionated on purpose.

When tradeoffs exist, it fixes the priority order:

```text
1. Correctness
2. Security and data integrity
3. Maintainability
4. Simplicity
5. Consistency with the existing architecture
6. Performance when supported by evidence
```

Performance sits last deliberately: it is optimized when measured, not when suspected.

The standard also requires the agent to:

- **Understand before changing.** Read the implementation, identify callers, dependencies and side effects. Never implement from a filename or an assumption.
- **Design for failure.** Invalid input, stale data, timeouts, partial failures, duplicate operations, retries, concurrency, interrupted operations. Never silently swallow an error.
- **Treat external input as untrusted.** Validate at boundaries, authentication is not authorization, parameterize queries, never log credentials, sanitize errors crossing a trust boundary.
- **Hold scope.** No unrelated refactors, no speculative abstractions, no redesigning working architecture without a concrete reason.
- **Test behavior and risk**, not implementation details. Never weaken a valid test to make a change pass.
- **Finish honestly.** Inspect the final diff, run format, lint, types, tests and build, then review the diff as if approving someone else's work for production. If a step could not run, say exactly what was not verified and why.

That last rule is the one the Stop gate enforces mechanically rather than trusting.

The installer also sets the model and effort used for this work:

```text
Model:  claude-opus-5
Effort: high
```

## How it works

Four layers, each doing one job.

```text
Engineering standard   fixed policy, every session, every repository
Project rules          generated from semantic analysis of this repository
Verification gate      environment preflight, then format/lint/types/tests/build
Living baseline        findings that persist across sessions and age with the code
```

They meet at the end of a task:

```text
Claude edits code
      ↓
PostToolUse hook records affected files
      ↓
Graft keeps repository context fresh
      ↓
Claude reaches Stop
      ↓
verification gate passes
      ↓
Graft builds change-impact context
      ↓
Claude Opus 5 · high effort
revalidates only affected findings
      ↓
OPEN / CHANGED / RESOLVED / STALE
+ concrete new risks from the changed scope
      ↓
engineering-baseline.md is updated only when needed
```

The baseline refresh is incremental. It does not re-audit the whole repository after every task, and a task that edited nothing relevant triggers no model call at all.

The baseline is advisory, not authoritative. The standard explicitly instructs Claude to verify a finding against current source and tests before acting on it, because a finding written three weeks ago may already be fixed.

## What runs at each step

### 1. While Claude edits — PostToolUse hook

Fires on `Write`, `Edit`, `MultiEdit` and `NotebookEdit`. Records the repository-relative paths the task touched into `~/.claude/harness-runtime/`.

It calls no model and does not modify the repository. It exists so the later baseline refresh knows the blast radius without having to guess.

### 2. Task ends — Stop hook

Runs two things in a fixed order, and the order is the point:

```text
1. verify the project
2. only if verification passed, refresh affected baseline findings
```

Verification failure is blocking. A baseline refresh failure is fail-soft: it never turns a successful code change into a failed task, and the dirty state is kept so a later Stop retries.

### 3. Before verification — environment preflight

Runs `.claude/preflight.sh` first, so a stopped local dependency is never mistaken for broken code. It checks, in order:

- Is Docker installed but not running? On macOS, start Docker Desktop and wait.
- Does `supabase/config.toml` exist? If the local stack is down, run `supabase start` and wait until ready.
- Does the repository actually reference Docker Compose in `package.json` or `scripts/`, or is `.claude/auto-compose` present? Only then bring Compose up.

Both waits are bounded, and the defaults are overridable:

```bash
HARNESS_DOCKER_WAIT_SECONDS=120
HARNESS_SUPABASE_WAIT_SECONDS=180
```

It never resets or deletes a local database to recover from a failed start. It stops and reports the environment problem. To make a run check-only without starting anything:

```bash
HARNESS_AUTO_INFRA=0 .claude/verify.sh
```

### 4. Verification — `.claude/verify.sh`

Picks the package manager from the lockfile: `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` or `bun.lock`, otherwise npm.

Then runs the strongest checks the project already has, cheapest and non-mutating first, stopping at the first failure:

```text
fmt:check       formatting, non-mutating
format:check    formatting, alternate script name
lint            static analysis
typecheck       falls back to test:types
test            the project's own suite
build           last, most expensive
```

Every one of those is skipped when `package.json` has no such script. Nothing is invented and nothing is guessed. A project with only `lint` and `test` runs exactly those two.

For a non-Node project, verify.sh exits and asks you to customize it. That is deliberate: silently verifying nothing is worse than saying it cannot.

### 5. Baseline refresh — `refresh-baseline.sh`

Receives the edited files, asks Graft for change-impact context, and hands Claude the current structured baseline.

The model runs restricted to read-only tools:

```text
Read
Glob
Grep
```

It cannot edit, and it is asked for exactly two things: revalidate existing findings the change could plausibly have affected, and detect concrete new risks inside the changed blast radius. It does not re-audit unrelated findings.

### 6. Repository initialization — `init-project.sh`

The expensive one, run by hand. It:

1. Resolves the Git root.
2. Refuses to initialize anything inside `~/.claude`.
3. Detects stack, package manager, monorepo shape, and verification commands.
4. Installs or wires Graft with `graft init --agents claude`.
5. Uses Graft to build repository orientation context.
6. Runs a read-only semantic analysis with Claude Opus 5 and high effort.
7. Generates repository-specific `.claude/rules/`.
8. Preserves existing `CLAUDE.md` content and updates only the harness-managed block.
9. Generates `.claude/engineering-baseline.md`.
10. Generates `.claude/engineering-baseline.json` with stable finding IDs.
11. Generates or preserves `.claude/preflight.sh`.
12. Generates `.claude/verify.sh` and wires the preflight into it.
13. Prepares required local verification infrastructure.
14. Runs the baseline verification.
15. Enables `.claude/verify-on-stop` when environment preparation and verification pass.
16. Enables `.claude/baseline-refresh-on-stop` when semantic analysis and verification pass.

Steps 15 and 16 matter: the automatic gates switch on only if they were proven to work once. A repository where verification cannot run does not get a gate that fails forever.

## Tests

Two separate things share the word, so worth being exact.

**In your repository, the harness runs tests, it does not write them.** Verification executes your existing `test` script through your package manager. It does not generate tests, does not invent a test command, and does not treat your suite as optional. If you have no `test` script, that step is skipped and the other checks still run.

What the harness contributes to testing is policy. When Claude writes tests under `**/*.test.*`, `**/*.spec.*`, `**/test/**` or `**/tests/**`, these rules load automatically:

- Test externally meaningful behavior and invariants, not implementation details.
- Keep tests deterministic and independent of execution order.
- Avoid arbitrary sleeps and timing-sensitive assertions where deterministic synchronization is possible.
- Name tests after the behavior or risk they protect.
- A regression test must fail for the original bug and pass for the fix.
- Do not mock the unit under test. Mock external boundaries only when it improves determinism without hiding the behavior being validated.
- Never weaken or delete a valid test to make a change pass.

**This repository has its own tests.** The scripts that edit `~/.claude/settings.json` are covered by round-trip tests that run them as real subprocesses against a throwaway `HOME`, because the risk they carry is what they do to a real config file on disk. They need nothing but Node 20+:

```bash
node --test tests/*.test.mjs
```

CI runs them on Node 20, 22 and 24, and lints every shell script with a pinned shellcheck.

## Baseline states

Findings receive stable IDs:

```text
F001
F002
F003
```

The Markdown baseline then evolves:

```text
[OPEN]     finding still exists
[CHANGED]  original finding was partly fixed or narrowed
[RESOLVED] current source and tests show it is fixed
[STALE]    old claim is no longer supportable
[NEW]      a concrete risk was introduced or discovered in changed scope
```

Example:

```text
Before
[OPEN] HIGH — Health endpoint returns 200 while degraded · F001

After a verified fix
[RESOLVED] HIGH — Health endpoint returns 200 while degraded · F001
```

`.claude/engineering-baseline.json` is the machine-readable state that preserves finding identity across refreshes.

## Full reanalysis

Incremental refresh maintains findings, not the entire architecture model.

If Opus determines a task materially changed project architecture, the baseline records:

```text
Full harness reanalysis recommended
```

Regenerating architecture and conditional project rules is still done by `init-project.sh`. This distinction prevents every ordinary feature from paying for a full repository analysis.

You can force a refresh by hand for diagnostics, though normal use never requires it:

```bash
~/.claude/harness-tools/refresh-baseline.sh --force
```

## Graft and the harness

Responsibilities are separate:

```text
Graft
  repository map
  symbols
  callers
  relationships
  blast radius
  freshness

Harness
  engineering policy
  project-specific rules
  business invariants
  living findings
  verification

Claude Code
  implementation and reasoning using both layers
```

Graft evidence accelerates navigation. Critical security, correctness, business-rule and mutation decisions must still be verified against source.

During install and project initialization the harness checks npm for a newer Graft release and upgrades only when the registry is ahead. It will not downgrade a locally installed build that is newer than npm latest.

## Typical initialized repository

```text
repo/
├── CLAUDE.md
├── .mcp.json
└── .claude/
    ├── engineering-baseline.md
    ├── engineering-baseline.json
    ├── baseline-refresh-on-stop
    ├── preflight.sh
    ├── verify.sh
    ├── verify-on-stop
    ├── settings.json
    ├── helpers/
    ├── skills/
    │   └── graft/
    │       └── SKILL.md
    └── rules/
        ├── project-architecture.md
        ├── harness-backend-integrity.md
        ├── harness-security-boundaries.md
        ├── harness-testing-strategy.md
        └── ...
```

## Global files

```text
~/.claude/
├── CLAUDE.md
├── harness/
│   ├── engineering.md
│   ├── project-analysis-prompt.md
│   ├── project-analysis-schema.json
│   ├── baseline-refresh-prompt.md
│   ├── baseline-refresh-schema.json
│   └── project-template/
├── rules/
├── skills/
│   └── engineering-review/
├── agents/
│   └── engineering-code-reviewer.md
├── hooks/
│   ├── verify-project.sh
│   └── mark-baseline-dirty.sh
├── harness-tools/
│   ├── init-project.sh
│   ├── refresh-baseline.sh
│   ├── render-project-analysis.mjs
│   ├── render-baseline-refresh.mjs
│   ├── remove-settings-hook.mjs
│   └── settings-io.mjs
├── harness-state.json
└── settings.json
```

`harness-state.json` records the `model` and `effortLevel` that were in `settings.json` before the first install, so uninstall can put them back. It is written once, never overwritten by a repeat install, and deleted by uninstall.

## Cost and latency

`init-project.sh` is the expensive operation, because it performs deep repository analysis.

After initialization, the harness performs at most one incremental baseline analysis per coding task, and only when that task actually edited relevant files. Multiple edits within one task collapse into a single refresh. Tasks with no relevant edits trigger no model call.

## Backups

```text
~/.claude/harness-backups/            global installation
~/.claude/harness-project-backups/    project initialization
~/.claude/harness-baseline-backups/   living-baseline updates
~/.claude/harness-project-analysis/   structured analysis archives
```

## Uninstall

```bash
./uninstall.sh
```

Removes harness-owned global files and hooks, and restores the model and effort settings that were in place before the first install. It preserves backup directories and does not uninstall Graft globally.
