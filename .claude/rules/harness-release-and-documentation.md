---
paths:
  - "README.md"
  - "README.es.md"
  - "CHANGELOG.md"
  - "VERSION"
  - "CLAUDE.md"
---
<!-- generated-by: claude-engineering-harness -->
# Release string and the mirrored documentation pair

The README is the product's only explanation of itself and exists in two languages; the CHANGELOG is where decisions are recorded in place of an ADR corpus. The version pairing is machine-checked because "v6" was once restated in five places while `VERSION` had zero consumers.

- `README.md` and `README.es.md` are a mirrored pair: both move in the same commit, or the Spanish reader gets a document that describes a harness that no longer exists. Nothing machine-checks this, so it is on the change author.
- Every user-visible change needs a `## Unreleased` entry in `CHANGELOG.md` that names the failure it fixes, not just the change made. The existing entries are the model for the level of detail expected.
- `VERSION` is the only place a release string is written. It must be a bare semantic version and must equal the newest released `CHANGELOG.md` heading; everything else derives from it at runtime.
- Do not restate the model or effort defaults in prose — `install.sh` reads them back from `HARNESS_DEFAULTS` precisely so it cannot announce a value it did not apply.
- A count stated in the README (test cases, files) is a claim that goes stale silently. Prefer a claim the reader can re-derive, and update both READMEs when the number moves.
- `CLAUDE.md` at the root records the constraints a change to this repository must not break, including a "deliberately absent" list. Before adding a plugin manifest, an ADR corpus, a diff-scoped CI gate or golden fixtures, read why they are absent.

Evidence used during harness analysis: `README.md`, `CHANGELOG.md`, `VERSION`, `CLAUDE.md`, `tests/version.test.mjs`, `install.sh`
