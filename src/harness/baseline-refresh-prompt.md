# Incremental Engineering Baseline Refresh

You are maintaining a living engineering baseline for an existing repository after a coding task.

The baseline is advisory evidence, never an authority over current source. Current source and executable tests win whenever they conflict with an older finding.

Your job is intentionally incremental. Do not re-audit the entire repository.

## What to do

1. Inspect the changed files and their nearby callers, dependencies, tests, and contracts.
2. Revalidate only existing findings plausibly affected by those changes.
3. For each affected existing finding, decide whether it is still open, materially changed, resolved, or stale.
4. Look for concrete new correctness, security, data-integrity, maintainability, or architectural risks introduced by the changed scope.
5. Do not invent findings merely to produce output.
6. Do not turn style preferences into findings unless the repository already enforces them or they create real maintenance risk.
7. Prefer evidence from current source and tests. Graft context is navigation evidence, not authority.
8. A finding can be resolved even when a historical document still describes the old behavior.
9. A finding is changed when part of the original claim is fixed but a materially different or narrower risk remains.
10. A finding is stale when its claim cannot be supported anymore and there is not enough evidence to call it a concrete resolved issue.

## Scope discipline

- Do not propose broad rewrites.
- Do not revisit unrelated existing findings.
- Do not change project architecture rules in this incremental pass.
- If the changes imply a fundamental architectural shift that should regenerate project rules, set `full_reanalysis_recommended` to true and explain why.

Return only the requested structured output.
