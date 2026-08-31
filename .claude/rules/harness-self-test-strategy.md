---
paths:
  - "tests/**"
---
<!-- generated-by: claude-engineering-harness -->
# How this repository tests itself

A defect here does not break one project, it breaks every project the harness is installed in — silently, because most failure modes are "a check that never ran". The suite is therefore behavioural and subprocess-based by design, and its conventions (throwaway HOME, PATH stubs, extract-and-compare for duplicated logic) are what make that affordable without dependencies.

- Use `node:test` and `node:assert/strict` only. There is no runner config and no dependency to add one; the suite runs as `node --test tests/*.test.mjs`.
- Test the shipped scripts as real subprocesses (`spawnSync`/`execFileSync`) against a throwaway `HOME` and a throwaway git repository. The risk being covered is what they do to a real file on a real disk, so do not reimplement shell logic in JavaScript to assert on it.
- Where a value or a pattern is deliberately duplicated between shell and JS, extract both from source and compare them — `tests/hooks.test.mjs` evaluates the `case` list with `bash` and the regex with `grep` rather than adding a third copy.
- Skip rather than fail when an external tool is unavailable: `{ skip }` guarded on `git` or `shellcheck`, following the existing `have()` helper.
- Every assertion carries a message naming the failure it catches, in the same voice as the existing ones ("a repository shipped its own verify-on-stop and the harness executed its verify.sh").
- Stub external CLIs on `PATH` — `graft`, `npm`, `claude`, `docker`, `supabase` — when the stack is not what is under test, and make the stub change state the way the real command does so a poll loop terminates.
- Clean up every fixture with `t.after`, and derive the runtime state directory the same way the hooks do rather than hardcoding a path.
- A new test must be shown to fail against the unfixed code. A test that passes both before and after reports coverage that does not exist — two shipped comments once claimed `tests/hooks.test.mjs` asserted something for months while the file did not exist.
- Open each test file with a comment naming the incident or the failure mode it exists for; the existing headers are the record of why the suite is shaped this way.
- Do not introduce byte-exact golden fixtures over prose-heavy renderer output: `CLAUDE.md` lists them as deliberately absent because they train regeneration without reading.

Evidence used during harness analysis: `tests/hooks.test.mjs`, `tests/consent.test.mjs`, `tests/payload.test.mjs`, `tests/render.test.mjs`, `tests/init-project.test.mjs`, `tests/stream-progress.test.mjs`, `tests/version.test.mjs`, `CLAUDE.md`
