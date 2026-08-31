# Repository Harness Analysis

Analyze this repository deeply enough to configure a project-specific Claude Code engineering harness.

Your task is discovery and review only. Do not modify files. Do not suggest a rewrite. Derive project-specific instructions from the repository that already exists.

## What to inspect

Inspect representative files across the repository, prioritizing:

- root and workspace manifests
- README and architecture documentation
- application and package boundaries
- entry points and dependency direction
- domain and business logic
- API, controller, handler, service, use-case, repository, and persistence layers
- authentication and authorization
- audit logging and sensitive mutations
- database schemas, migrations, transactions, and data-access patterns
- frontend component structure, state management, hooks, routing, and design system
- validation and error-handling patterns
- tests and test configuration
- CI, lint, typecheck, build, and verification configuration
- existing CLAUDE.md, AGENTS.md, Cursor, Copilot, or repository-specific instruction files as clues

Ignore generated output, vendored dependencies, caches, build artifacts, coverage, lockfile internals, and node_modules unless a specific configuration question requires them.

## Analysis rules

- Verify claims against code or repository documentation.
- Do not invent architecture, conventions, business rules, permissions, or invariants.
- Existing instruction files are evidence, but cross-check important claims against implementation when practical.
- Prefer current patterns that are consistently used over isolated legacy code.
- Distinguish deliberate architecture from accidental duplication.
- Do not repeat generic engineering principles already covered by the global harness.
- Every generated rule should be specific enough to influence an implementation decision in this repository.
- Keep always-on rules few and high-value.
- Use path-scoped rule groups whenever a rule only matters to one area of the repository.
- Path patterns must be repository-relative globs. Never emit absolute paths or paths containing `..`.
- Evidence paths must be repository-relative and point to files or directories you actually inspected.
- Findings should be concrete. Report the axes honestly; it is normal for a repository to have no finding that computes to critical.
- Do not manufacture issues just to populate the review.

## Rating a finding

Do not rate a finding. Report three facts about it and the harness computes the rating, so the
same finding gets the same level on every run and two projects' ratings mean the same thing.

- `impact` — what breaks if this goes wrong.
- `trigger` — what must happen for the **harm** to occur, not for the code path to run. A global
  install of a package at `@latest` runs every time, but the harm needs a bad version to be
  published first: that is `hypothetical`, not `already_occurring`. Getting this backwards inflates
  every finding in the report.
- `blast_radius` — how far the consequence reaches.

The schema defines each value. Choose the one the evidence supports; do not pick a harsher value to
signal that a finding matters, or a milder one to signal that it is tolerated.

## Is the finding worth acting on

The three axes above measure harm only. Nothing in them says what removing the finding costs, so a
real but trivial weakness that needs a cross-cutting refactor reads exactly like a one-line bug.
Report that cost as `fix_cost` and the harness crosses the two: a `low` finding whose fix is
contained or invasive is filed as carried rather than as work to do, while harm at `high` or above
stays worth acting on however expensive the fix is.

Cost the fix you actually wrote in `recommendation`, in files and call sites, not the ideal
redesign you would prefer. This is the field that lets a finding be real and still not worth doing:
use it instead of dropping the finding or softening its axes to keep it out of the report.

## Desired harness behavior

The resulting harness should help future agents:

- preserve the real architecture and dependency direction
- reuse established project abstractions
- respect authentication, authorization, auditing, and data-integrity boundaries
- follow the existing design system and frontend patterns
- use the repository's validation and error conventions
- write tests that match the repository's testing strategy
- avoid known maintainability and correctness risks
- make focused changes without unrelated refactors

## Output language

Write every prose field — titles, rationales, rules, summaries, findings, confidence notes — in
the natural language this repository uses for its own documentation, comments and user-facing
strings. That is not necessarily the language of this prompt. If the repository mixes languages,
follow the dominant one. Identifiers, paths, commands and quoted code stay exactly as they appear
in the source.

If `.claude/rules/harness-*.md` files already exist here, a previous run of this same analysis
wrote them: read one and keep writing in the language it uses. The rule set is regenerated whole
on every re-initialization, so a language that changes between runs rewrites every file at once
and leaves nothing in the diff to read.

## Output guidance

- `summary`: concise description of what the system does and how it is organized.
- `architecture_summary`: concise description of architectural style and dependency direction.
- `key_modules`: the most important modules or packages, not an exhaustive directory listing.
- `always_on_rules`: at most 12 repository-specific instructions that truly apply across the project.
- `business_invariants`: only invariants clearly evidenced by code or documentation.
- `rule_groups`: 2 to 8 focused rule groups. Use an empty paths list only when the entire repository should load the rule.
- `risks`: at most 10 concrete production, security, correctness, or maintainability risks with evidence, an incremental recommendation, and the three rating axes described above.

Every finding must be judgeable by someone who did not write it. The axes say how bad the
consequence would be; they never say what actually goes wrong, so a reader given only a severity
has no way to throw a finding out. Write `detail` as the mechanism in causal order and `example` as
one concrete run that ends badly — a named actor, the step that fails, the wrong state left behind.
An example you cannot ground in this repository's own code is a finding you should not report.

Zero to three findings is the ordinary result of this analysis. Ten is the ceiling of the array, not
a target, and a repository that yields nothing you would act on is a correct outcome: return an
empty `risks` list rather than padding it to look thorough.
- `confidence_notes`: ambiguities, incomplete areas, or conclusions that could not be verified.

Do not include secrets, credentials, tokens, personal data values, or copied sensitive payloads in the output.
