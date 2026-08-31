---
paths:
  - "src/harness/**"
  - "src/rules/**"
  - "src/agents/**"
  - "src/skills/**"
---
<!-- generated-by: claude-engineering-harness -->
# Prompts, schemas and the rules loaded as instructions

These files are the harness's actual product: they become instructions in every future session of every installed project. The naming and frontmatter contracts are what let install and uninstall stay symmetric, and the schema contract is what turns the model's response into something a renderer can rely on instead of prose.

- Every file under `src/rules/` must be named `harness-*.md`, or `uninstall.sh`'s glob will leave it installed forever, and must open with a `paths:` frontmatter list so it loads only for matching files. `tests/rules.test.mjs` enforces both.
- Keep both JSON schemas closed (`additionalProperties: false`), keep every `required` key defined, and keep them parseable after `tr -d '\n'` — the callers strip newlines before passing the schema on the command line.
- Do not ask the model for a key no renderer reads: `tests/schemas.test.mjs` compares the schema's top-level properties against the renderer source.
- `engineering.md` loads into every session in every directory. Keep it stack-agnostic and short enough to stay read; anything specific to one language or area belongs in a path-scoped rule under `src/rules/`.
- Prompts must preserve the "absence is not data" contract: state explicitly when no structural evidence was obtained rather than omitting the section, and distinguish "the tool is not installed" from "the tool returned nothing".
- A rule line is worth shipping only if it would change an implementation decision. Do not restate what `engineering.md` already says — the generated project rules are told the same thing.
- The reviewer agent and the review skill are read-only by contract; do not give either the ability to edit.
- A change here reaches every installed project through the next `install.sh`, and generated rule files are only refreshed when a user reruns `init-project.sh`. Treat prompt and schema edits as the highest-blast-radius change in the repository.

Evidence used during harness analysis: `src/harness/project-analysis-schema.json`, `tests/rules.test.mjs`, `tests/schemas.test.mjs`, `tools/render-project-analysis.mjs`, `install.sh`, `uninstall.sh`
