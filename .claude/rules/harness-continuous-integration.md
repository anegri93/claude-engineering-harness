---
paths:
  - ".github/workflows/**"
---
<!-- generated-by: claude-engineering-harness -->
# What CI must keep executing

CI is the only place the Bash 3.2 and BSD-userland claim is actually verified, and it was previously a documented requirement verified by nothing. Each pin in the workflow carries a comment explaining the failure it prevents.

- Keep the macOS matrix entry and the `bash32` job. A platform that is not executed is not supported, and the two most recent shell regressions were macOS-only — one of them passed `bash -n` on the machine that shipped it.
- The `bash32` job pins `PATH="/bin:$PATH"` so every spawned `bash` resolves to 3.2 rather than the runner's newer build, and asserts the version first. Keep both steps.
- Keep shellcheck pinned to `koalaman/shellcheck:v0.11.0` rather than using the runner's preinstalled build: the versions disagree on codes and an unpinned job fails on findings that are clean locally.
- Derive the linted file set from `git ls-files '*.sh'` so a script added under a new directory is linted instead of silently skipped.
- Keep `permissions: contents: read`.
- Do not add a diff-scoped gate: this repository pushes directly to `main`, so `github.base_ref` is empty and such a gate would run zero times. The invariants here are properties of the tree.
- The Node matrix is the compatibility claim the README makes (20, 22, 24). Widening or narrowing it is a documentation change too.

Evidence used during harness analysis: `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md`
