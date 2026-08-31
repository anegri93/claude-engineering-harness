<!-- generated-by: claude-engineering-harness -->
# Engineering Baseline

Living engineering baseline generated from repository evidence. Findings are advisory and must always be revalidated against current source and tests before action. The harness refreshes affected findings automatically after verified Claude Code changes.

## System

`claude-engineering-harness` is not an application but a personal Claude Code harness: a payload of Bash scripts, dependency-free Node ESM tools and Markdown instructions that `install.sh` copies into `~/.claude` and that `tools/init-project.sh` then wires into individual repositories. Globally it installs a fixed engineering standard (`src/harness/engineering.md`) as a `~/.claude/CLAUDE.md` import, two Claude Code hooks (a PostToolUse edit recorder and a Stop verification gate), path-scoped rules under `src/rules/`, a review skill and a read-only reviewer agent. Per project it wires Graft, runs a read-only Opus 5 analysis against a closed JSON schema, renders the result into `.claude/rules/`, a managed `CLAUDE.md` block and a living `engineering-baseline.md`/`.json`, generates `.claude/verify.sh` and `.claude/preflight.sh` from the detected stack, and enables the Stop gate only after that project's verification was observed to pass once. The repository has no `package.json`, no lockfile and no dependencies; it verifies itself with `node --test tests/*.test.mjs` plus a pinned shellcheck, on Linux and macOS across Node 20/22/24 and once under real Bash 3.2.

## Architecture

Four layers with deliberately little overlap (README.md "Boundary"): Claude Code owns the runtime, Graft owns the repository map, this harness owns engineering policy and the verification gate, and the user's repository owns the code and the scripts that verify it. Dependency direction inside the repository is one-way and shallow: `install.sh`/`uninstall.sh` walk the payload trees (`src/`, `project-template/`, `tools/`) and copy them into `~/.claude`; the shipped hooks in `src/hooks/` invoke `tools/refresh-baseline.sh` only through its installed copy at `$HOME/.claude/harness-tools/`; the shell scripts drive the `claude` CLI and hand its JSON to the Node renderers in `tools/*.mjs`, which are pure file-in/file-out processes with no shell knowledge and no cross-imports except `tools/settings-io.mjs`, shared by `merge-settings.mjs` and `remove-settings-hook.mjs`. Two boundaries are load-bearing and asymmetric: consent to execute repository-shipped scripts is read only from `~/.claude/harness-runtime/<project>/` and never from the repository, and verification failure blocks with exit 2 while everything advisory — baseline refresh, environment conditions — reports and exits 0, keeping its dirty marker for the next Stop.

## Active findings

### [OPEN] MEDIUM — Graft- and Claude-written project files are untracked and unignored in this repository · F001

`.claude/` (settings.json, helpers/, skills/graft/, the generated rules and baseline), `.mcp.json` and `.ignore` are present but untracked, and `.gitignore` ignores only `/graft/`. `verify-project.sh` decides whether a session changed anything from `git diff` plus `git ls-files --others --exclude-standard`; a permanently non-empty untracked set makes `TREE_CHANGED` always true, so the full verification suite runs after every Stop in this repository — including sessions that only answered a question. That is the exact cost problem `ignore_graft_output()` was written to fix for `graft/`, and the README names it as the strongest reason a user disables the gate.

- Evidence: `src/hooks/verify-project.sh`, `tools/init-project.sh`, `.gitignore`, `README.md`
- Incremental recommendation: Decide per file and record it: commit the ones that are configuration (`.mcp.json`, `.claude/settings.json`) or add the Graft-written paths to `.gitignore` next to the existing `/graft/` entry. Extending `ignore_graft_output()` to cover the other paths `graft init` writes would fix it for every initialized project at once.

### [OPEN] MEDIUM — The baseline `.md`/`.json` pair is replaced by four non-atomic copies · F002

`refresh-baseline.sh` backs up both files and then runs `cp` over `engineering-baseline.md` and `engineering-baseline.json` in sequence. This runs inside the Stop hook, which `merge-settings.mjs` installs with `timeout: 900` — after verification has already consumed part of that budget. A timeout, a `Ctrl-C` or a full disk between the two copies leaves the human-readable baseline and the machine state disagreeing about finding IDs, which is the same inconsistency the CHANGELOG records as the reason `set -e` was removed from this script. Everywhere else the repository is strict about this: `writeJsonFileAtomic` exists precisely so an interrupted write cannot truncate.

- Evidence: `tools/refresh-baseline.sh`, `tools/settings-io.mjs`, `tools/merge-settings.mjs`, `CLAUDE.md`
- Incremental recommendation: Write both files into the project's `.claude/` as sibling temp files first, then `mv` each over its target back to back, so the window where the pair can disagree is two renames rather than two full copies. The backup step already gives a recovery path if it still tears.

### [OPEN] MEDIUM — `CLAUDE.md` is rewritten in place during initialization, against the repository's own rule · F003

`merge_managed_claude()` in `init-project.sh` strips the managed block into a temp file, then redirects a second `awk` straight onto `$CLAUDE_FILE`, truncating it before appending the refreshed block. An interruption between the truncation and the final `cat` leaves the user's `CLAUDE.md` empty or half-written. `CLAUDE.md` states the rule as "never overwrite a user file in place — write a temp file and rename over the target", and `writeJsonFileAtomic` implements exactly that for settings. A backup under `harness-project-backups/` exists, but recovery is manual and the file is the user's own prose.

- Evidence: `tools/init-project.sh`, `tools/settings-io.mjs`, `CLAUDE.md`
- Incremental recommendation: Assemble the whole new `CLAUDE.md` in the existing temp file and `mv` it over the target once, mirroring what the Docker-lint splice already does for `verify.sh` (`> "$VERIFY_FILE.tmp" && mv`). It is a two-line change in the same function.

### [OPEN] MEDIUM — Graft is installed and upgraded globally from `@latest` with no pin · F004

`install.sh` and `tools/init-project.sh` both run `npm install -g @nanonets/graft@latest` whenever the registry reports a version ahead of the installed one, and `init-project.sh` performs that check on every project initialization — which the README instructs users to rerun after every harness upgrade. A single third-party package is therefore installed globally and silently updated on a schedule the user does not control, in a repository whose stated standard is "review a dependency before adding it".

- Evidence: `install.sh`, `tools/init-project.sh`, `README.md`
- Incremental recommendation: Record the Graft version the harness has been tested against (a `GRAFT_VERSION` constant beside `VERSION`) and install that by default, keeping `@latest` behind an explicit opt-in flag. At minimum, print the resolved version before installing so an unexpected jump is visible in the init output.

### [OPEN] MEDIUM — `tools/init-project.sh` concentrates most of the harness's behaviour in one 1,260-line script · F005

One file performs argument parsing, project-root resolution, stack and script detection, Graft wiring and evidence gathering, the streamed model call, rendering, CLAUDE.md merging, rule installation, preflight approval, per-stack `verify.sh` synthesis, the hadolint splice, preflight execution, verification, infrastructure teardown and the summary. Two shipped regressions already lived in the `verify.sh` generation section alone (the Dockerfile block never inserted on macOS, and a Bash 3.2 unbound-array abort). Coverage exists but is indirect: `tests/init-project.test.mjs` drives the whole script with `--skip-graft --skip-ai-analysis --skip-verify` and inspects the file it produced.

- Evidence: `tools/init-project.sh`, `tests/init-project.test.mjs`, `CHANGELOG.md`
- Incremental recommendation: Do not grow it further in place. When the next section needs changing, extract that one — `verify.sh` generation is the natural first candidate, since it is self-contained, already has its own test file, and would become directly testable rather than only observable through its output.

### [NEW] MEDIUM — The severity axis vocabularies are duplicated between `tools/severity.mjs` and both JSON schemas, with no test comparing them · F011

`IMPACT`, `TRIGGER` and `BLAST_RADIUS` in tools/severity.mjs:21-23 must match the `enum` lists the model is offered in src/harness/project-analysis-schema.json:90-92 and src/harness/baseline-refresh-schema.json:14-16,37-39 — three literal copies of each vocabulary. Nothing checks that they agree. tests/severity.test.mjs:42-47 is titled "the axis vocabularies are the ones the schemas offer" but asserts the arrays against hardcoded literals in the test file; it never reads either schema, so it passes unchanged if a schema enum is edited. tests/schemas.test.mjs validates parsing, newline survival, closure, `required` completeness and top-level key readership, but never descends into enums.

The drift fails in the passing direction, which is what makes it worth a test. Add or rename a value in a schema (`availability`, `correctness`, `module`) and the model will dutifully return it; `severityOf` finds no `TABLE[impact]` row (tools/severity.mjs:43-44) and returns `UNRATED`, so every finding rated on that axis renders as `NOT MEASURED` and — because `severityRank` deliberately sorts unrated last (tools/severity.mjs:73-76) — becomes the first candidate the retention cap drops (tools/render-baseline-refresh.mjs:42,45-53). Real findings are pruned in favour of rated ones, and no command exits non-zero. The repository already treats exactly this shape of coupling as requiring a mechanical check: invariant I007 pins the duplicated ignore logic in `mark-baseline-dirty.sh` against `refresh-baseline.sh` decision by decision, and I009/I010 pin the other cross-file agreements. This one is the same class and currently rests on convention.

Rated conservatively: the fallback is visible rather than silent-and-mild (`NOT MEASURED` reads as unmeasured, never as `low`), and the harm needs a deliberate enum edit, so this is a latent drift risk across every initialized project rather than a defect occurring now.

- Evidence: `tools/severity.mjs`, `tests/severity.test.mjs`, `tests/schemas.test.mjs`, `src/harness/project-analysis-schema.json`, `src/harness/baseline-refresh-schema.json`, `tools/render-baseline-refresh.mjs`
- Incremental recommendation: In tests/schemas.test.mjs, import `IMPACT`/`TRIGGER`/`BLAST_RADIUS` from `tools/severity.mjs` and assert each equals the corresponding `enum` at every site that declares it (`risks.items`, `finding_reviews.items`, `new_findings.items`), so a value added to one place fails the suite. Then drop the hardcoded vocabulary assertion in tests/severity.test.mjs:42-47 or retitle it, since it currently claims a schema relationship it does not verify. Keep the exhaustive `EXPECTED` table in severity.test.mjs written out by hand — that duplication is deliberate and correct.

### [OPEN] LOW — A failed hadolint splice warns and continues, producing a `verify.sh` with no Dockerfile lint · F006

The Dockerfile lint block is inserted by scanning the generated `verify.sh` for the `HARNESS_PREFLIGHT_DONE` line. If that marker ever changes in one of the five per-stack heredocs and not in the splice condition, `DOCKER_LINT_INSERTED` stays false and the script prints a warning to stderr, then continues to `chmod +x` and enable the gate. The warning lands in the middle of a long initialization log, so a project would quietly verify without the Dockerfile check it is documented to have. `tests/init-project.test.mjs` asserts the block is present for four stacks, which is what keeps this hypothetical.

- Evidence: `tools/init-project.sh`, `tests/init-project.test.mjs`
- Incremental recommendation: Make the splice failure fatal for the generation step, or surface it in the final summary block alongside `Verification:` rather than only at the point it happens — the summary is the part of the output a user actually reads.

### [OPEN] LOW — Repository file content reaches the prompt that writes always-loaded instruction files · F007

Still open, and the changed scope narrows it only slightly. `risks` entries are now constrained to three enums (`impact`/`trigger`/`blast_radius`, src/harness/project-analysis-schema.json:90-92) and `tools/render-project-analysis.mjs:349,367` derives `severity` through `severityOf()` instead of accepting a level the model wrote, so repository text can no longer steer a finding's rating through a free-text field — the model can only pick from a closed vocabulary that a table then interprets. That removes one influence channel, not the one the finding is about. Rule group titles, rationales and bodies are still model-authored prose written into `.claude/rules/harness-*.md`, which Claude Code loads as instructions every session, and the mechanical guards are unchanged (`safeRuleText` at tools/render-project-analysis.mjs:66-72 still strips a leading `@` and markdown link targets; paths, globs and slugs are sanitized separately). The recommendation is also still unimplemented: `src/harness/project-analysis-prompt.md:32` frames only "existing instruction files" as evidence, and nothing states that everything read from the repository is data to be described rather than instructions to follow. Note that finding `detail`/`title`/`recommendation` reach `engineering-baseline.md` through `text()` rather than `safeRuleText()` (tools/render-project-analysis.mjs:368-372, 383-396), so the `@`-import and link neutralization does not cover the baseline — pre-existing, and lower risk because the baseline is referenced by path rather than `@`-imported.

- Evidence: `tools/render-project-analysis.mjs`, `src/harness/project-analysis-prompt.md`, `src/harness/project-analysis-schema.json`, `tests/render.test.mjs`
- Incremental recommendation: Unchanged and still cheap: one line in `src/harness/project-analysis-prompt.md` extending the framing already applied to the Graft block to repository file content generally. Separately, consider routing finding `detail` through `safeRuleText` in both renderers so the baseline gets the same `@`/link neutralization the rule files already have.

### [OPEN] LOW — The README mirror obligation is enforced by convention alone · F008

`CLAUDE.md` states that `README.md` and `README.es.md` move together in the same commit, and the two are substantial documents that both currently carry uncommitted changes. The comparable pairing — `VERSION` against the newest released `CHANGELOG.md` heading — is machine-checked in `tests/version.test.mjs`, and the repository's own history shows that an unverified documentation claim survives for months (the two comments referencing a test file that did not exist).

- Evidence: `CLAUDE.md`, `README.md`, `tests/version.test.mjs`
- Incremental recommendation: A cheap structural check would catch the common case without policing prose: assert the two files have the same set of `##` headings in the same order, or the same number of Mermaid blocks and tables. That fails on a section added to one and not the other, which is the drift that actually happens.

### [OPEN] LOW — `.claude/verify.sh` is executed on every Stop with no integrity check, while `preflight.sh` is hash-pinned · F009

The consent model records an approval hash for a custom `preflight.sh` and withdraws it when the file changes, but `verify.sh` — which the Stop hook executes on every task once the project is adopted — has no equivalent. `init-project.sh` regenerates `verify.sh` from the detected stack rather than adopting the repository's, which closes the clone case, but a later `git pull` in an adopted repository can replace it and it will run unchallenged. The README states this is out of scope by design, comparing it to trusting a `Makefile`.

- Evidence: `tools/init-project.sh`, `src/hooks/verify-project.sh`, `README.md`, `tests/consent.test.mjs`
- Incremental recommendation: This is a documented, accepted boundary rather than a defect — treat it as such unless the decision changes. If it is revisited, the cheapest increment is to record `verify.sh`'s hash alongside the `verify-on-stop` marker when it is written and print a one-line notice on Stop when it no longer matches, without blocking.

### [OPEN] LOW — Runtime state keys collide when no SHA-256 tool is available · F010

`init-project.sh`, `verify-project.sh` and `refresh-baseline.sh` each derive the per-project state directory as `<basename>_<sha256 prefix>`, falling back to the literal `nohash` when neither `shasum` nor `sha256sum` is on PATH. On such a machine two different checkouts sharing a directory name (`api`, `web`, `app`) map to the same `~/.claude/harness-runtime/` directory, so consent granted for one repository silently enables the Stop gate and the paid refresh for the other, and their `changed-files.txt` records merge.

- Evidence: `tools/init-project.sh`, `src/hooks/verify-project.sh`, `src/hooks/mark-baseline-dirty.sh`, `tools/refresh-baseline.sh`
- Incremental recommendation: Treat a missing hash tool as an environment condition rather than a silent fallback: have `init-project.sh` refuse to write markers and say which command to install, so consent is never recorded under a key that cannot distinguish projects. The hooks then simply find no marker and stay inert.

## Evidenced business invariants

- The Stop gate and the living-baseline refresh are enabled for a project only after `init-project.sh` observed that project's verification pass once, and the markers live in `~/.claude/harness-runtime/<project>/` where no repository can write them. A previous grant is revoked at the start of every rerun and must be re-earned. [I001]
  - Evidence: `tools/init-project.sh`, `src/hooks/verify-project.sh`, `src/hooks/mark-baseline-dirty.sh`, `tests/consent.test.mjs`, `tests/init-project.test.mjs`
- A `.claude/preflight.sh` the harness did not generate is preserved byte-for-byte but not executed: its executable bit is cleared until approved with `--trust-preflight`, and the approval records that exact file's SHA-256, so a later edit or `git pull` withdraws it. [I002]
  - Evidence: `tools/init-project.sh`, `tests/consent.test.mjs`
- Baseline findings keep stable `F###` identity across refreshes. New IDs come from the persisted `next_finding_id` counter, never from the current maximum, so an ID freed by the retention cap is never handed to a different finding. [I003]
  - Evidence: `tools/render-baseline-refresh.mjs`, `tools/render-project-analysis.mjs`, `tests/render.test.mjs`
- The living baseline is capped at 20 active and 15 resolved/stale findings, dropping the lowest severity first and oldest-first within a severity, and pruning is reported rather than silent. [I004]
  - Evidence: `tools/render-baseline-refresh.mjs`, `tools/refresh-baseline.sh`, `tests/render.test.mjs`
- A rule group is identified across re-initializations by the area its `paths:` cover — equal, subset or superset after `**` segments are dropped — not by the filename the model returns, so a rerun edits an existing `harness-*.md` instead of renaming it. The frontmatter still records the glob exactly as the model wrote it, because there the depth is the meaning. [I005]
  - Evidence: `tools/render-project-analysis.mjs`, `tests/render.test.mjs`
- The `harness-` prefix is added by the renderer and is never part of the topic: any prefix the model supplied is stripped first, so re-initialization cannot produce `harness-harness-<topic>`. [I006]
  - Evidence: `tools/render-project-analysis.mjs`, `src/harness/project-analysis-schema.json`, `tests/render.test.mjs`
- The ignore list in the `case` statement of `src/hooks/mark-baseline-dirty.sh` and the `grep -Ev` regex in `tools/refresh-baseline.sh` must make the same call on every path; they are a deliberate duplication with a test that compares them decision by decision. [I007]
  - Evidence: `src/hooks/mark-baseline-dirty.sh`, `tools/refresh-baseline.sh`, `tests/hooks.test.mjs`
- `VERSION` is the single source of the release string: it must be a bare semantic version, must equal the newest released `CHANGELOG.md` heading, is installed to `~/.claude/harness/VERSION`, and no shipped script may restate a release number in prose. [I008]
  - Evidence: `VERSION`, `install.sh`, `CHANGELOG.md`, `tests/version.test.mjs`
- `claude-opus-5` / `high` are authoritative only in `HARNESS_DEFAULTS`. The hand-copied `settings-hook-snippet.json`, the installer's completion banner and the two shell scripts' analysis fallbacks all derive from or are pinned to it, and the snippet may claim no key the installer does not apply. [I009]
  - Evidence: `tools/settings-io.mjs`, `install.sh`, `tests/defaults.test.mjs`
- Both JSON schemas must parse, survive the `tr -d '\n'` their callers apply, close their top level with `additionalProperties: false`, define every key they list in `required`, and ask only for top-level keys the matching renderer actually reads. [I010]
  - Evidence: `src/harness/project-analysis-schema.json`, `tests/schemas.test.mjs`, `tools/render-project-analysis.mjs`
- Every shipped rule under `src/rules/` is named `harness-*.md` so uninstall's glob removes it, and declares a `paths:` frontmatter list so it never loads in a session it does not apply to. [I011]
  - Evidence: `tests/rules.test.mjs`, `uninstall.sh`, `install.sh`
- Uninstall reverses only what the harness applied: a `model`/`effortLevel` the user changed after installing survives, empty hook containers the harness created are removed, and files outside the `harness-*` namespace are never deleted. [I012]
  - Evidence: `tools/remove-settings-hook.mjs`, `tests/payload.test.mjs`, `tests/defaults.test.mjs`

## Analysis limitations

- This analysis was run against the harness repository itself, while `CLAUDE.md` states that "the harness does not run against itself for its own generated rules (that would be circular)" and that the root `CLAUDE.md` is where its constraints live. There is intentional overlap between that file and the rules generated here; treat `CLAUDE.md` as authoritative where they differ.
- No commands were executed: the test suite, shellcheck and the Bash 3.2 job were not run as part of this analysis. Every claim about what a test asserts comes from reading the test file, not from observing it pass.
- The working tree carries uncommitted modifications to `CHANGELOG.md`, `CLAUDE.md`, `README.md`, `README.es.md`, `tools/init-project.sh` and `tests/init-project.test.mjs`, plus untracked `.claude/`, `.mcp.json` and `.ignore`. Conclusions describe the working tree, not `HEAD`.
- The README states "121 tests across 12 files". Twelve test files were confirmed to exist; the count of individual cases was not verified by running them.
- The Graft repository map covered only `tools/` and `tests/` — 18 JavaScript files. The shell scripts, which carry most of the harness's behaviour and all of its consent and exit-code logic, produced no structural evidence, so every conclusion about them comes from reading the source directly.
- `src/harness/engineering.md` was not opened as a file; its content was taken from the global engineering standard injected into this session, which the README describes as that same file. `src/harness/project-analysis-prompt.md` and `baseline-refresh-prompt.md` were likewise not read directly — statements about prompt behaviour come from how `init-project.sh` and `refresh-baseline.sh` assemble and assert on them, and from `tests/graft-evidence.test.mjs`.
- `src/rules/*.md`, `src/agents/`, `src/skills/`, `project-template/CLAUDE.md`, `project-template/.claude/verify.sh` and `project-template/.claude/rules/project-architecture.md` were listed but not read in full; rules about them rest on `tests/rules.test.mjs`, `install.sh`/`uninstall.sh` globs and `tools/init-project.sh`.
- Several behaviours depend on flags and event shapes of the external `claude` CLI (`--safe-mode`, `--json-schema`, `--effort`, the `stream-json` event types) and on `graft map`/`graft ask` output. Those contracts were read from how the scripts use them and could not be verified against either tool.
- The severity of the untracked-`.claude` finding assumes the Stop gate is currently enabled for this project; that marker lives in `~/.claude/harness-runtime/` and was not inspected, since it is outside the repository.
- Rule-group `paths` were chosen to match the areas the existing `.claude/rules/harness-*.md` files already declare, so the renderer's scope matcher should reuse those filenames and produce edits rather than renames; that reuse was not executed and verified here.

A full architecture/rule regeneration still comes from `~/.claude/harness-tools/init-project.sh`; routine finding freshness is automatic on Claude Code Stop after successful verification.
