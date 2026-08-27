# Claude Engineering Harness

[English](README.md) · [Español](README.es.md)

A personal Claude Code harness for maintainable, secure, correct, scalable code. It combines a permanent engineering standard, repository-specific semantic rules, Graft repository context, automatic local test infrastructure, deterministic verification, and a living engineering baseline.

## Automatic environment preflight

Before lint, tests, or builds are treated as broken, the harness runs `.claude/preflight.sh`. For a Supabase project this means the initializer and the Stop gate can detect a stopped local stack, ensure Docker is available, start Supabase, wait until it is ready, and only then run the project's verification.

Every initialized project gets a generated `.claude/preflight.sh` unless a custom one already exists. The generated script is intentionally conservative.

It currently handles:

- Supabase local projects when `supabase/config.toml` exists.
- Docker Desktop startup on macOS when Docker is installed but stopped.
- Docker Compose when the repository itself references Compose in `package.json` or `scripts/`, or when `.claude/auto-compose` is explicitly present.

For Supabase the normal flow is:

```text
verify
  ↓
preflight
  ↓
Docker running? ── no ──→ start Docker Desktop on macOS
  ↓
Supabase running? ── no ──→ supabase start
  ↓
wait until ready
  ↓
lint / typecheck / test / build
```

The same preflight runs during the Stop quality gate, so a stopped local dependency does not permanently disable verification.

To make preflight check-only for a run:

```bash
HARNESS_AUTO_INFRA=0 .claude/verify.sh
```

Optional timeout controls:

```bash
HARNESS_DOCKER_WAIT_SECONDS=120
HARNESS_SUPABASE_WAIT_SECONDS=180
```

The harness does not automatically reset or delete local databases when startup fails. It stops and reports the environment problem instead.

## Living baseline

`.claude/engineering-baseline.md` is a living technical memory.

The lifecycle is:

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

The refresh is incremental. It does not re-audit the full repository after every task.

## Global standard

The installer configures:

```text
Model:  claude-opus-5
Effort: high
```

Graft becomes the standard repository-context layer. During harness install and project initialization the harness checks npm for a newer Graft release and upgrades only when the registry version is newer. It will not downgrade an installed build that is ahead of npm latest.

The global harness instructs Claude to prioritize:

1. Correctness
2. Security and data integrity
3. Maintainability
4. Simplicity
5. Consistency with existing architecture
6. Measured performance

It also explicitly states that the engineering baseline is advisory. Claude must verify a finding against current source and tests before acting on it.

## Install or upgrade

From the downloaded folder:

```bash
chmod +x install.sh
./install.sh
```

The installer preserves unrelated Claude Code configuration and backs up touched files under:

```text
~/.claude/harness-backups/<timestamp>/
```

Restart Claude Code after installation.

## Initialize or upgrade a repository

Enter anywhere inside the repository:

```bash
~/.claude/harness-tools/init-project.sh
```

Rerun it after upgrading the harness. It refreshes the generated project files and keeps the existing living baseline state.

The initializer:

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

## Baseline states

Initial findings receive stable IDs such as:

```text
F001
F002
F003
```

The Markdown baseline can then evolve like this:

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

The generated JSON file is the machine-readable state used to preserve finding identity across refreshes.

## Automatic refresh hooks

The harness installs two global living-baseline hooks.

### PostToolUse

For Claude Code edit tools:

```text
Write
Edit
MultiEdit
NotebookEdit
```

The hook records the repository-relative files touched by the task in runtime state under:

```text
~/.claude/harness-runtime/
```

It does not call a model and does not modify the repository.

### Stop

The Stop gate performs work in this order:

```text
1. verify project
2. only if verification succeeds, refresh affected baseline findings
```

Baseline refresh failure is fail-soft. It does not turn a successful code change into a failed task. The dirty state is retained so a later Stop can retry.

Verification failure is blocking.

## Incremental baseline analysis

The refresh command is normally automatic:

```bash
~/.claude/harness-tools/refresh-baseline.sh
```

It receives the files edited during the task, obtains Graft impact context, gives Claude the current structured baseline, and allows read-only source verification through:

```text
Read
Glob
Grep
```

It asks Opus 5 high to do only two things:

- revalidate existing findings plausibly affected by the change
- detect concrete new engineering risks inside the changed blast radius

It explicitly does not re-audit unrelated findings.

You can force it manually for diagnostics:

```bash
~/.claude/harness-tools/refresh-baseline.sh --force
```

Normal use does not require this command.

## Full reanalysis

Incremental refresh maintains findings, not the entire architecture model.

If Opus determines that a task materially changed project architecture, the baseline records:

```text
Full harness reanalysis recommended
```

A full regeneration of architecture and conditional project rules is still performed by:

```bash
~/.claude/harness-tools/init-project.sh
```

This distinction prevents every ordinary feature from paying for a full repository analysis.

## Graft and the harness

Responsibilities remain separate:

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

Graft evidence accelerates navigation. Critical security, correctness, business-rule, and mutation decisions must still be verified against source.

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

## Tests

The scripts that edit `~/.claude/settings.json` are covered by round-trip tests that run
them as real subprocesses against a throwaway `HOME`. They need nothing but Node 20+:

```bash
node --test tests/*.test.mjs
```

## Cost and latency behavior

A full `init-project.sh` remains the expensive operation because it performs deep repository analysis.

After initialization, the harness performs at most one incremental Opus baseline analysis after a Claude coding task that actually edited relevant files. Multiple edits in the same task are collapsed into one refresh.

Tasks with no relevant edits do not trigger a baseline model call.

## Backups

Global installation backups:

```text
~/.claude/harness-backups/
```

Project initialization backups:

```text
~/.claude/harness-project-backups/
```

Living-baseline update backups:

```text
~/.claude/harness-baseline-backups/
```

Structured analysis archives:

```text
~/.claude/harness-project-analysis/
```

## Uninstall

```bash
./uninstall.sh
```

The uninstaller removes harness-owned global files and hooks. It preserves backup directories and does not uninstall Graft globally.
