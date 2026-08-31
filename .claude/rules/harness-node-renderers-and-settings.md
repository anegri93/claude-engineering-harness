---
paths:
  - "tools/*.mjs"
---
<!-- generated-by: claude-engineering-harness -->
# Node tools: untrusted model output, atomic writes, stable identity

These files are where a model's output becomes durable instruction files in someone's repository and where a user's `settings.json` is rewritten. The sanitizers, the atomic write and the stable finding identity are each documented against a specific incident — a repeated `harness-` prefix observed at the third run on a real project, and rule files renamed wholesale over one character of glob.

- ESM `.mjs` with `node:` builtins only. No dependency may be added, and no `package.json` may be introduced to hold one.
- Treat every string from a model as untrusted input: paths through `safeRepoPath`, globs through `safeGlob`, filenames through `safeSlug`, and rule bodies through `safeRuleText`, which neutralizes a leading `@` (a Claude Code file import) and strips markdown link and image targets while keeping the link text.
- The `harness-` prefix is the harness's ownership marker and is added by the renderer. Strip any prefix the model supplied before adding it, so a re-initialization edits the rule file instead of growing a new prefix.
- Rule-file identity across runs comes from `scopeOf`/`sameScope` — the area the declared globs cover, with `**` segments dropped — never from the model's filename. Normalize only for the comparison: the frontmatter must keep the glob exactly as the model wrote it.
- Allocate finding IDs from the persisted `next_finding_id`, never from the current maximum, or a number freed by the retention cap will later be handed to a different finding.
- Keep the retention caps (20 active, 15 resolved/stale, lowest severity dropped first, oldest-first within a severity) and keep pruning visible in the returned counts.
- Write JSON through `writeJsonFileAtomic`. Settings edits must be idempotent, must preserve unrelated keys and foreign hooks, and must leave a malformed `settings.json` untouched with a single readable error.
- `HARNESS_DEFAULTS` in `settings-io.mjs` is the only authoritative copy of the model and effort defaults. Anything that needs them derives or is pinned to them; nothing restates them.
- A renderer must throw rather than emit a partial artifact: no `structured_output`, or a missing `summary`/`architecture_summary`, is a failure, not an empty section.
- In `stream-progress.mjs`, stdout stays untouched for the caller and progress goes to stderr; strip control characters from model-authored text before it reaches a terminal, and treat a stream that ends without a `result` event as an error.
- Any key added to a JSON schema must be read by its renderer, and any key the renderer stops reading must leave the schema — otherwise the cost is paid and the answer discarded.

Evidence used during harness analysis: `tools/render-project-analysis.mjs`, `tools/render-baseline-refresh.mjs`, `tools/settings-io.mjs`, `tools/merge-settings.mjs`, `tools/remove-settings-hook.mjs`, `tools/stream-progress.mjs`, `tests/render.test.mjs`, `tests/schemas.test.mjs`
