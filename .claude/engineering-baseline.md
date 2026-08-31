<!-- generated-by: claude-engineering-harness -->
# Engineering Baseline

Living engineering baseline generated from repository evidence. Findings are advisory and must always be revalidated against current source and tests before action. The harness refreshes affected findings automatically after verified Claude Code changes.

## System

`claude-engineering-harness` is not an application but a personal Claude Code harness: a payload of Bash scripts, dependency-free Node ESM tools and Markdown instructions that `install.sh` copies into `~/.claude` and that `tools/init-project.sh` then wires into individual repositories. Globally it installs a fixed engineering standard (`src/harness/engineering.md`) as a `~/.claude/CLAUDE.md` import, two Claude Code hooks (a PostToolUse edit recorder and a Stop verification gate), path-scoped rules under `src/rules/`, a review skill and a read-only reviewer agent. Per project it wires Graft, runs a read-only Opus 5 analysis against a closed JSON schema, renders the result into `.claude/rules/`, a managed `CLAUDE.md` block and a living `engineering-baseline.md`/`.json`, generates `.claude/verify.sh` and `.claude/preflight.sh` from the detected stack, and enables the Stop gate only after that project's verification was observed to pass once. The repository has no `package.json`, no lockfile and no dependencies; it verifies itself with `node --test tests/*.test.mjs` plus a pinned shellcheck, on Linux and macOS across Node 20/22/24 and once under real Bash 3.2.

## Architecture

Four layers with deliberately little overlap (README.md "Boundary"): Claude Code owns the runtime, Graft owns the repository map, this harness owns engineering policy and the verification gate, and the user's repository owns the code and the scripts that verify it. Dependency direction inside the repository is one-way and shallow: `install.sh`/`uninstall.sh` walk the payload trees (`src/`, `project-template/`, `tools/`) and copy them into `~/.claude`; the shipped hooks in `src/hooks/` invoke `tools/refresh-baseline.sh` only through its installed copy at `$HOME/.claude/harness-tools/`; the shell scripts drive the `claude` CLI and hand its JSON to the Node renderers in `tools/*.mjs`, which are pure file-in/file-out processes with no shell knowledge and no cross-imports except `tools/settings-io.mjs`, shared by `merge-settings.mjs` and `remove-settings-hook.mjs`. Two boundaries are load-bearing and asymmetric: consent to execute repository-shipped scripts is read only from `~/.claude/harness-runtime/<project>/` and never from the repository, and verification failure blocks with exit 2 while everything advisory — baseline refresh, environment conditions — reports and exits 0, keeping its dirty marker for the next Stop.

## Active findings

### [OPEN] HIGH — A Compose stack the preflight starts is neither recorded nor announced, so the one-shot initializer leaves it running while reporting that it restored the machine · F012

Unchanged. `ensure_supabase` still records or announces (project-template/.claude/preflight.sh:118-123: append `supabase` to `$HARNESS_INFRA_STARTED_FILE`, or else print that the stack was left running and the command that stops it). `ensure_compose` (project-template/.claude/preflight.sh:153-157) still runs `docker compose up -d` and returns without doing either. The teardown in `tools/init-project.sh:1202` still matches only the literal line `supabase` (`grep -Fqx supabase`), so a Compose stack started by an init run is left up while the initializer reports that it put the machine back.

This task changed `tools/init-project.sh`, but only the runtime-state cleanup at lines 1229-1232; neither the teardown nor the preflight moved.

- Evidence: `project-template/.claude/preflight.sh`, `tools/init-project.sh`, `tests/init-project.test.mjs`, `.claude/rules/harness-generated-project-scaffold.md`
- Rated: incorrect_result × normal_use × component
- Incremental recommendation: Unchanged: give `ensure_compose` the same ending `ensure_supabase` has — check `docker compose -f "$compose_file" ps -q` first and, only when the stack was down, append a `compose` line to `$HARNESS_INFRA_STARTED_FILE` or else print that it was left running with `docker compose -f <file> down`. Then extend tools/init-project.sh:1202 to handle a `compose` line, and add the record-or-announce assertions to the two existing Compose cases in `tests/init-project.test.mjs`, which today check only whether `up -d` was issued.

### [NEW] HIGH — The git-derived changed set is a fallback, not the peer source its comment claims, so a session that mixes Edit and Bash edits hides its Bash edits from the refresh · F014

The comment at tools/refresh-baseline.sh:71-76 states the design: the PostToolUse edit record only fires for Write/Edit/MultiEdit/NotebookEdit, a task that edits through Bash leaves it empty, "Git sees those edits, so it is a peer source of the changed set and not a --force-only fallback." The code below implements a fallback, not a peer. Line 89-91 reads `changed-files.txt` into `CHANGED_FILES`; line 92 then takes the git set only `if [[ -z "$CHANGED_FILES" ]]`. The two are never unioned.

So the fix holds for a session that edits *exclusively* through Bash, and fails for a session that mixes. Claude writes one file with Edit and patches another with `sed -i`, a heredoc or a formatter run through Bash: the PostToolUse hook records only the first, `CHANGED_FILES` is non-empty, and the git set that contains the second is discarded at line 92. `RELEVANT_FILES` (line 105) then carries the incomplete list into the Graft blast-radius query (line 136), into the "Files changed in this task" block of the prompt (lines 147-148) and into the fingerprint (line 117). The refresh runs, spends the model call, and reports "Engineering baseline refreshed" or "no finding changes in this task's blast radius" (lines 227-231) over a scope that never included the Bash-edited file. Nothing prints that the list was partial, and line 240 then clears the dirty marker so the omission is not retried. That is a check reporting work it did not do, which the new test file's own header calls "the only kind this repository is really afraid of".

Coverage matches the gap. `tests/baseline-refresh-trigger.test.mjs:127-139` asserts the pure-Bash case (edit record absent entirely) and `:141-147` the clean case; no test creates a `changed-files.txt` alongside a wider git set, which is the mixed session.

- Evidence: `tools/refresh-baseline.sh`, `tests/baseline-refresh-trigger.test.mjs`, `src/hooks/mark-baseline-dirty.sh`
- Rated: incorrect_result × normal_use × component
- Incremental recommendation: Make the code match the comment: replace the `if [[ -z "$CHANGED_FILES" ]]` fallback at tools/refresh-baseline.sh:92-94 with a union — `CHANGED_FILES="$(printf '%s\n%s\n' "$CHANGED_FILES" "$GIT_CHANGED" | sed '/^[[:space:]]*$/d' | sort -u | head -n 80)"` — leaving the existing `grep -Ev` ignore filter at line 105 to drop harness bookkeeping from the merged set as it already does for the git-only set. Add a case to `tests/baseline-refresh-trigger.test.mjs` that writes a `changed-files.txt` naming one file while a second file is edited on disk, and asserts the prompt the stub receives names both; it fails against the current fallback.

### [OPEN] MEDIUM — The baseline `.md`/`.json` pair is replaced by four non-atomic copies · F002

Unchanged by this task. `tools/refresh-baseline.sh:213-216` still backs up both files and then runs `cp` over `engineering-baseline.md` and `engineering-baseline.json` in sequence, with no temp-file-and-rename. The script deliberately runs without `errexit` (line 2, restated at lines 186-188 and 199-201) so every failure below the model call is fail-soft, which means a failed second `cp` does not abort — it falls through to line 240, deletes the dirty marker and the changed-file record, and writes the fingerprint, so the next Stop sees a clean, already-analysed state and never retries.

The changed scope narrows nothing but adds one more way to reach the window: the refresh is no longer gated on the PostToolUse edit record, so it now runs on any Stop where git reports a changed set (line 78-86). More runs through the same two-copy window, same window.

- Evidence: `tools/refresh-baseline.sh`, `tools/settings-io.mjs`, `tools/merge-settings.mjs`, `CLAUDE.md`
- Rated: data_loss × specific_conditions × component
- Incremental recommendation: Unchanged: write both files into the project's `.claude/` as sibling temp files, then `mv` each over its target back to back, so the window where the pair can disagree is two renames rather than two full copies. While there, move the `rm -f "$DIRTY_FILE" "$CHANGED_FILE"` at tools/refresh-baseline.sh:240 behind a check that both copies succeeded, so a torn write is retried by the next Stop instead of being recorded as done.

### [OPEN] MEDIUM — `CLAUDE.md` is rewritten in place during initialization, against the repository's own rule · F003

`merge_managed_claude()` in `init-project.sh` strips the managed block into a temp file, then redirects a second `awk` straight onto `$CLAUDE_FILE`, truncating it before appending the refreshed block. An interruption between the truncation and the final `cat` leaves the user's `CLAUDE.md` empty or half-written. `CLAUDE.md` states the rule as "never overwrite a user file in place — write a temp file and rename over the target", and `writeJsonFileAtomic` implements exactly that for settings. A backup under `harness-project-backups/` exists, but recovery is manual and the file is the user's own prose.

- Evidence: `tools/init-project.sh`, `tools/settings-io.mjs`, `CLAUDE.md`
- Rated: carried over from a baseline written before severity axes existed; not re-measured
- Incremental recommendation: Assemble the whole new `CLAUDE.md` in the existing temp file and `mv` it over the target once, mirroring what the Docker-lint splice already does for `verify.sh` (`> "$VERIFY_FILE.tmp" && mv`). It is a two-line change in the same function.

### [OPEN] MEDIUM — Graft is installed and upgraded globally from `@latest` with no pin · F004

`install.sh` and `tools/init-project.sh` both run `npm install -g @nanonets/graft@latest` whenever the registry reports a version ahead of the installed one, and `init-project.sh` performs that check on every project initialization — which the README instructs users to rerun after every harness upgrade. A single third-party package is therefore installed globally and silently updated on a schedule the user does not control, in a repository whose stated standard is "review a dependency before adding it".

- Evidence: `install.sh`, `tools/init-project.sh`, `README.md`
- Rated: carried over from a baseline written before severity axes existed; not re-measured
- Incremental recommendation: Record the Graft version the harness has been tested against (a `GRAFT_VERSION` constant beside `VERSION`) and install that by default, keeping `@latest` behind an explicit opt-in flag. At minimum, print the resolved version before installing so an unexpected jump is visible in the init output.

### [OPEN] MEDIUM — `tools/init-project.sh` concentrates most of the harness's behaviour in one script · F005

Still open; the file is now 1,303 lines rather than the 1,260 the finding recorded. This task's edit to it was small and correct — tools/init-project.sh:1229-1232 clears `changed-fingerprint` alongside `baseline-dirty` and `changed-files.txt` when the refresh marker is granted, with a comment explaining that a brand-new baseline must not be suppressed by a fingerprint from before it existed — but it is one more responsibility in the same script rather than an extraction. The structural claim is unchanged: argument parsing, stack detection, Graft wiring, the streamed model call, rendering, CLAUDE.md merging, preflight approval and hashing, per-stack `verify.sh` synthesis, the hadolint splice, infrastructure teardown and the summary all live here, and coverage remains indirect through `tests/init-project.test.mjs` driving the whole script.

- Evidence: `tools/init-project.sh`, `tests/init-project.test.mjs`
- Rated: maintenance × normal_use × component
- Incremental recommendation: Unchanged: do not grow it further in place. `verify.sh` generation is still the natural first extraction — self-contained, already exercised by its own test file, and it would become directly testable rather than only observable through the file it produces.

### [OPEN] MEDIUM — Repository file content reaches the prompt that writes always-loaded instruction files · F007

Still open, and this task edited the file the recommendation names without adding the line. `src/harness/project-analysis-prompt.md:32` still frames only "existing instruction files" as evidence to cross-check; nothing anywhere in the prompt says that everything read from the repository is data to be described rather than instructions to follow. Rule group titles, rationales and bodies remain model-authored prose written into `.claude/rules/harness-*.md`, which Claude Code loads every session, and the mechanical guards are unchanged (`safeRuleText` at tools/render-project-analysis.mjs:66-72 strips a leading `@` and markdown link targets; it is applied to summaries, responsibilities, titles and rationales).

The secondary note stands and has widened slightly: finding text still reaches `engineering-baseline.md` through `text()` rather than `safeRuleText()`, and the new `example` field joins it (tools/render-project-analysis.mjs:418,468 and tools/render-baseline-refresh.mjs:108,193), so the `@`-import and link neutralization covers the rule files but not the baseline. Lower risk, because the baseline is referenced by path rather than `@`-imported.

The rating moved from `low` to `medium` because axes replaced a legacy label, not because the risk grew: security impact, no known path today, consequence contained to one initialized project's rule files.

- Evidence: `src/harness/project-analysis-prompt.md`, `tools/render-project-analysis.mjs`, `tools/render-baseline-refresh.mjs`, `src/harness/project-analysis-schema.json`
- Rated: security × hypothetical × component
- Incremental recommendation: Unchanged and still one line in `src/harness/project-analysis-prompt.md`: extend the framing already applied to the Graft block to repository file content generally. Separately, route finding `detail` and `example` through `safeRuleText` in both renderers so the baseline gets the same `@`/link neutralization the rule files already have.

### [NEW] MEDIUM — The refresh fingerprint hashes file names only, so repeated Bash-only edits to the same files are skipped as an unchanged tree · F015

The new fingerprint exists to stop a working tree that stays dirty across turns from buying a paid model call on every Stop (tools/refresh-baseline.sh:111-114). It is computed from `RELEVANT_FILES` (line 117) — a sorted list of *paths*. No file content, no `git diff` hash, no HEAD revision, no mtime. Lines 123-127 then exit 0 silently when the stored fingerprint matches, which is correct for "nothing moved" and wrong for "the same files moved again".

The skip is guarded by `! -f "$DIRTY_FILE"`, so a session that used Write/Edit is always analysed. The exposed case is the one the whole change was written for: consecutive Bash-only sessions. Session 1 rewrites `src/auth.ts` through a heredoc; the refresh runs and stores the hash of the single line `src/auth.ts`. Session 2 rewrites `src/auth.ts` again through `sed -i` — a different change entirely, still uncommitted, still the only dirty path. `GIT_CHANGED` is byte-identical, the fingerprint matches, and the script exits at line 125 having printed nothing at all. The second change is never reviewed, and because the fingerprint file is only rewritten at line 246 after a completed run, the stale entry keeps matching for as long as the tree keeps that shape.

The `head -n 80` truncation at lines 79 and 90 widens this in a large dirty tree: only the first 80 sorted paths reach the fingerprint, so edits to anything sorting after them cannot change it.

`tests/baseline-refresh-trigger.test.mjs:149-165` pins the intended half of this and stops short of the failing half — it earns a second model call by creating a *new* file (`other.ts`), never by editing `src.ts` a second time. Adding that assertion to the same test would fail today.

- Evidence: `tools/refresh-baseline.sh`, `tests/baseline-refresh-trigger.test.mjs`
- Rated: incorrect_result × specific_conditions × component
- Incremental recommendation: Fingerprint what changed, not which files did. In tools/refresh-baseline.sh:115-120, hash content rather than the path list — e.g. feed `git diff HEAD -- $RELEVANT_FILES` (plus the untracked files' own hashes) or `git status --porcelain=v1 -z` output through the same `shasum`/`sha256sum` branch, falling back to the current path-list hash when git is unavailable, and keep the ignore filter ahead of it so a cache file under `graft/` still cannot read as a new changed set. Then extend the third test in `tests/baseline-refresh-trigger.test.mjs` with a second edit to `src.ts` asserting a third model call.

### [OPEN] LOW — A failed hadolint splice warns and continues, producing a `verify.sh` with no Dockerfile lint · F006

The Dockerfile lint block is inserted by scanning the generated `verify.sh` for the `HARNESS_PREFLIGHT_DONE` line. If that marker ever changes in one of the five per-stack heredocs and not in the splice condition, `DOCKER_LINT_INSERTED` stays false and the script prints a warning to stderr, then continues to `chmod +x` and enable the gate. The warning lands in the middle of a long initialization log, so a project would quietly verify without the Dockerfile check it is documented to have. `tests/init-project.test.mjs` asserts the block is present for four stacks, which is what keeps this hypothetical.

- Evidence: `tools/init-project.sh`, `tests/init-project.test.mjs`
- Rated: carried over from a baseline written before severity axes existed; not re-measured
- Incremental recommendation: Make the splice failure fatal for the generation step, or surface it in the final summary block alongside `Verification:` rather than only at the point it happens — the summary is the part of the output a user actually reads.

### [OPEN] LOW — The README mirror obligation is enforced by convention alone · F008

`CLAUDE.md` states that `README.md` and `README.es.md` move together in the same commit, and the two are substantial documents that both currently carry uncommitted changes. The comparable pairing — `VERSION` against the newest released `CHANGELOG.md` heading — is machine-checked in `tests/version.test.mjs`, and the repository's own history shows that an unverified documentation claim survives for months (the two comments referencing a test file that did not exist).

- Evidence: `CLAUDE.md`, `README.md`, `tests/version.test.mjs`
- Rated: carried over from a baseline written before severity axes existed; not re-measured
- Incremental recommendation: A cheap structural check would catch the common case without policing prose: assert the two files have the same set of `##` headings in the same order, or the same number of Mermaid blocks and tables. That fails on a section added to one and not the other, which is the drift that actually happens.

### [OPEN] LOW — Runtime state keys collide when no SHA-256 tool is available · F010

`init-project.sh`, `verify-project.sh` and `refresh-baseline.sh` each derive the per-project state directory as `<basename>_<sha256 prefix>`, falling back to the literal `nohash` when neither `shasum` nor `sha256sum` is on PATH. On such a machine two different checkouts sharing a directory name (`api`, `web`, `app`) map to the same `~/.claude/harness-runtime/` directory, so consent granted for one repository silently enables the Stop gate and the paid refresh for the other, and their `changed-files.txt` records merge.

- Evidence: `tools/init-project.sh`, `src/hooks/verify-project.sh`, `src/hooks/mark-baseline-dirty.sh`, `tools/refresh-baseline.sh`
- Rated: carried over from a baseline written before severity axes existed; not re-measured
- Incremental recommendation: Treat a missing hash tool as an environment condition rather than a silent fallback: have `init-project.sh` refuse to write markers and say which command to install, so consent is never recorded under a key that cannot distinguish projects. The hooks then simply find no marker and stay inert.

### [NEW] LOW — The widened Compose heuristic treats any mention in a root script as consent, including comments, teardown commands and a different compose file · F013

`project_references_compose` now also returns true when `grep -E -q 'docker[ -]compose|docker compose' ./*.sh Makefile` matches (project-template/.claude/preflight.sh:147-149). The match is any occurrence anywhere in those files: a comment (`# to reset, run docker compose down`), a teardown-only script, a CI helper, or a deploy script that runs `docker compose -f docker-compose.prod.yml up -d`. In every one of those cases the preflight then brings up `$compose_file` — the first of `compose.yml`/`compose.yaml`/`docker-compose.yml`/`docker-compose.yaml` found in the root (project-template/.claude/preflight.sh:126-129) — which need not be the file the script referred to. Since the preflight runs before every Stop verification once the gate is earned, this recurs each task, and on macOS `ensure_docker` will start Docker Desktop to do it.

The file itself names this as the thing to avoid: "A compose file alone is not consent to start it: a repository can ship one for an optional monitoring stack or a demo, and launching unrelated services is exactly what the standard forbids" (tests/init-project.test.mjs:219-221; .claude/rules/harness-generated-project-scaffold.md:14). The same over-matching already existed for `grep -R` over `scripts/`, so this is a widening of an accepted heuristic rather than a new mechanism, and `HARNESS_AUTO_COMPOSE=0` plus `HARNESS_AUTO_INFRA=0` remain escape hatches — hence the conservative rating. Coverage is one positive (`start.sh` running `docker compose up -d`) and one negative (`start.sh` running `npm run dev`) at tests/init-project.test.mjs:255-271; neither the `Makefile` arm nor any false-positive shape is exercised.

- Evidence: `project-template/.claude/preflight.sh`, `tests/init-project.test.mjs`, `.claude/rules/harness-generated-project-scaffold.md`, `README.md`
- Rated: maintenance × specific_conditions × component
- Incremental recommendation: Narrow the match to a Compose command rather than a Compose mention: require the line to look like an invocation that brings a stack up, e.g. `grep -E -q '^[^#]*docker([ -])compose([^|;&]*)(-f [^ ]+ )?up'`, so comments and `down`/`stop` lines stop counting. Add a `Makefile` case and one false-positive case (a root script whose only mention is a comment) to `composeRun`, both of which fail against the current pattern.

### [NEW] LOW — The project-analysis prompt still tells the model there are three rating axes after a fourth was added · F016

`src/harness/project-analysis-prompt.md` gained a "Is the finding worth acting on" section (lines 71-81) describing `fix_cost` as a reported fact, and `src/harness/project-analysis-schema.json:93,104` now requires it on every entry of `risks`. The field list further down the same prompt was not updated with it: line 117 still describes `risks` as needing "an incremental recommendation, and the three rating axes described above". A reader — human or model — following the field list rather than the prose section is told the contract is three axes when it is four.

No behavioural consequence today: the schema requires `fix_cost`, so a response omitting it does not validate, and `tools/render-project-analysis.mjs:414` reads it either way. This is a stale count in an instruction file, in the class of drift the repository already machine-checks elsewhere (`VERSION` against the newest `CHANGELOG.md` heading, invariant I008).

- Evidence: `src/harness/project-analysis-prompt.md`, `src/harness/project-analysis-schema.json`, `tools/render-project-analysis.mjs`
- Rated: cosmetic × normal_use × local
- Incremental recommendation: One line: change "the three rating axes described above" at src/harness/project-analysis-prompt.md:117 to name the four axes, or drop the count and refer to the sections above rather than restating how many there are — the same reason no shipped script restates a release number.

## Resolved findings

### [RESOLVED] MEDIUM — Graft- and Claude-written project files are untracked and unignored in this repository · F001

The condition the finding described no longer holds. `.gitignore:14-17` now ignores `/graft/` with a comment naming exactly this cost ("leaving them untracked-but-not-ignored is worse, because the Stop hook reads `git ls-files --others` to decide whether anything happened"), and the files the finding named as untracked are tracked: `.claude/settings.json`, `.claude/verify.sh`, `.claude/preflight.sh`, `.claude/engineering-baseline.{md,json}`, `.mcp.json` and `.ignore` all exist and none appear in the working tree's untracked set, whose only entry is the test file this task added. `.gitignore:10-12` additionally covers `harness-backups/`, `harness-runtime/` and `.claude/baseline-dirty`.

The change matters more now than when the finding was written: `tools/refresh-baseline.sh:79` added `git ls-files --others --exclude-standard` as a second consumer of the untracked set, so a permanently non-empty untracked set would have bought a paid model call on the first Stop after every `graft build` as well as running the full verification suite. Both consumers are now clean.

- Evidence: `.gitignore`, `tools/refresh-baseline.sh`, `src/hooks/verify-project.sh`, `.claude/settings.json`, `.mcp.json`
- Rated: maintenance × normal_use × component
- Incremental recommendation: Nothing further. If `graft init` later starts writing another root-level path, add it beside the `/graft/` entry rather than leaving it untracked, since two separate hooks now key off `git ls-files --others`.
- Resolution note: Resolved by tracking the generated project files and ignoring `/graft/` in `.gitignore:14-17`. Verified from the file listing and the session's git status, which shows only `tests/baseline-refresh-trigger.test.mjs` as untracked; no git command was executed as part of this refresh.

### [RESOLVED] LOW — The severity axis vocabularies are duplicated between `tools/severity.mjs` and both JSON schemas, with no test comparing them · F011

The mechanical check the finding asked for now exists, and it was written to cover more than the finding described. `tests/severity.test.mjs:62-84` walks both `src/harness/project-analysis-schema.json` and `src/harness/baseline-refresh-schema.json`, collects every node keyed `impact`, `trigger`, `blast_radius` or `fix_cost` that declares an `enum`, asserts the site count is exactly 12 so a vanished site cannot make the comparison pass over nothing, and then `deepEqual`s each site's values against `IMPACT`/`TRIGGER`/`BLAST_RADIUS`/`FIX_COST` imported from `tools/severity.mjs`. The hardcoded vocabulary assertion the finding said claimed a relationship it did not verify is gone; the exhaustive `EXPECTED` table at tests/severity.test.mjs:36-42 is written out by hand on purpose and remains, which is what the finding recommended.

The check landed in `tests/severity.test.mjs` rather than `tests/schemas.test.mjs` as recommended. That is the same guarantee in a different file, and it arrived in time to cover the fourth axis: `fix_cost` (tools/severity.mjs:97) was added to both schemas in this same period and is included in the comparison, so the duplication grew from three vocabularies to four without reopening the gap.

- Evidence: `tests/severity.test.mjs`, `tools/severity.mjs`, `src/harness/project-analysis-schema.json`, `src/harness/baseline-refresh-schema.json`
- Rated: incorrect_result × hypothetical × component
- Incremental recommendation: No further action. Keep the `sites.length` assertion in step with the schemas when an axis is added or a schema gains a new items block, since that count is what stops the comparison from silently iterating an empty list.
- Resolution note: Resolved by tests/severity.test.mjs:62-84, which reads both schemas and compares all 12 axis enum sites against the severity module. Read, not executed: this refresh ran no commands.

## Accepted risks

Real risks the project has decided to carry. The rating states the risk; the status states the decision.

### [ACCEPTED] HIGH — `.claude/verify.sh` is executed on every Stop with no integrity check, while `preflight.sh` is hash-pinned · F009

Code evidence is unchanged by this task: `tools/init-project.sh:913-971` still hash-pins a custom `preflight.sh` (`preflight-approved` in the runtime state dir, withdrawn on edit), while `verify.sh` is regenerated and then executed on every Stop with no recorded hash. What changed is the status, not the risk. README.md:560-562 states the boundary in writing — "once you have adopted a repository, its `verify.sh` is a script you run, and a later `git pull` can change it. That is the same trust you extend to a `Makefile` or a `package.json` script — the harness does not add a second layer over it" — and CHANGELOG.md:7 records that the `accepted` status was added precisely because "this repository's own documented `verify.sh` trust boundary came back rated `low`" when the only way to express a carried risk was to understate it. The rating now states the risk (a repository-shipped script executing with the user's credentials after an adopted repo is updated) and the status states the decision.

- Evidence: `README.md`, `CHANGELOG.md`, `tools/init-project.sh`, `src/hooks/verify-project.sh`, `tests/consent.test.mjs`
- Rated: security × specific_conditions × component
- Incremental recommendation: Carry it as documented. If the decision is ever revisited, the cheapest increment is still to record `verify.sh`'s hash alongside the `verify-on-stop` marker and print a one-line non-blocking notice on Stop when it no longer matches.
- Resolution note: Not a code change: reclassified from `open` to `accepted` because the repository documents the boundary in README.md:560-562 and the baseline schema now has a status for a risk the project has decided to carry.

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
