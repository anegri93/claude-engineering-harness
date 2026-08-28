# Global Engineering Standard

These principles apply to every code change unless a project has a more specific documented constraint.

## Priorities

When tradeoffs exist, prioritize in this order:

1. Correctness
2. Security and data integrity
3. Maintainability
4. Simplicity
5. Consistency with the existing architecture
6. Performance when supported by evidence

## Repository orientation and Graft

Graft is the standard repository-context layer when it is available in the project.

For non-trivial code changes:

- Use Graft for initial repository orientation before broad manual exploration.
- Prefer Graft repository maps, code search, API surfaces, and call traces to discover relevant modules and blast radius efficiently.
- Use Graft context to narrow where to inspect, then verify critical contracts, security decisions, business rules, and mutation behavior in the source itself.
- Treat Graft as an acceleration and navigation layer, not as a substitute for reading authoritative code when correctness depends on details.
- Respect Graft freshness and blast-radius signals after edits.
- If Graft is unavailable or cannot answer a question, fall back to direct repository inspection without blocking the task.

## Understand before changing

Before modifying code:

- Read the relevant implementation.
- Understand existing patterns and architectural boundaries.
- Identify callers, dependencies, side effects, and data flow.
- Do not implement based only on filenames or assumptions.
- Reuse established project patterns when they remain appropriate.
- Prefer the smallest coherent change that fully solves the requested problem.

## Implementation

- Prefer explicit and predictable code over clever code.
- Keep responsibilities focused.
- Keep coupling low and cohesion high.
- Make dependencies explicit.
- Avoid hidden global mutable state.
- Avoid unnecessary abstractions.
- Avoid speculative extensibility.
- Avoid meaningful duplication while not forcing unrelated code into one abstraction.
- Do not introduce a new architectural pattern when an existing one solves the problem adequately.
- Do not mix unrelated refactors with the requested change.
- Preserve public contracts unless changing them is intentional.
- Remove dead code created by the change.
- Use names that communicate intent.
- Document decisions and non-obvious constraints rather than narrating obvious code.

## Correctness and reliability

Design for failure, not only for the happy path.

Consider when relevant:

- invalid input
- missing or stale data
- external service failures
- timeouts
- partial failures
- duplicate operations
- retries
- concurrency
- race conditions
- inconsistent state
- interrupted operations

Requirements:

- Make invalid states difficult to represent.
- Validate assumptions at system boundaries.
- Do not silently swallow errors.
- Preserve data consistency above convenience.
- Make retryable critical operations idempotent when practical.
- Bound retries and external waits.
- Keep failure behavior explicit and observable.

## Security

Treat external input as untrusted.

- Validate runtime input at boundaries.
- Authentication does not replace authorization.
- Apply least privilege.
- Never expose or commit secrets.
- Never log credentials, tokens, or sensitive payloads without an explicit approved reason.
- Avoid unsafe dynamic execution.
- Avoid injection-prone APIs and parameterize database queries.
- Sanitize errors returned across trust boundaries.
- Review new dependencies before introducing them.
- Prefer secure defaults.

## Scalability

Prefer architectural scalability over infrastructure complexity.

- Preserve clear module boundaries and contracts.
- Prefer stateless components where practical.
- Keep infrastructure replaceable behind meaningful boundaries.
- Avoid unnecessary microservices, queues, caches, and distributed coordination.
- Optimize measured bottlenecks, not hypothetical ones.
- Consider operational cost and failure modes before adding infrastructure.

## Scope discipline

- Do not improve unrelated code unless required for the requested change.
- Do not redesign working architecture without a concrete reason.
- Do not add abstractions for hypothetical future requirements.
- Do not add dependencies for trivial functionality already available in the project or platform.
- Keep diffs focused and reviewable.

## Testing

Test behavior and risk rather than implementation details.

Prioritize:

- business rules
- edge cases
- failure paths
- regressions
- concurrency
- important integrations

Requirements:

- When fixing a meaningful bug, consider a regression test that reproduces it.
- Tests must be deterministic.
- Avoid excessive mocking when a stable integration test gives stronger confidence.
- Do not weaken or delete a valid test merely to make a change pass.
- Do not chase coverage numbers without a risk-based reason.
- A new test must be shown to fail against the unfixed code. A test that passes both before
  and after is worse than none: it reports coverage that does not exist.

## Living engineering baseline

`.claude/engineering-baseline.md` is a living advisory snapshot, not an authoritative specification.

Before acting on any baseline finding:

- Verify it against current source and executable tests.
- Prefer current implementation evidence when it conflicts with an older finding.
- Determine whether later changes already resolved, narrowed, or invalidated the finding.
- Re-evaluate both the stated impact and the proposed remediation instead of applying the recommendation mechanically.
- Do not edit generated baseline files by hand during normal feature work; let the harness refresh affected findings after verified changes.
- If the baseline flags a full reanalysis because architecture materially changed, treat that as a signal that project rules may need regeneration.

## Verification environment

When the repository provides `.claude/preflight.sh`, use it as the canonical preparation step for local verification infrastructure.

- Distinguish an unavailable local dependency from a code defect.
- Allow the preflight to start explicitly detected local development infrastructure such as Supabase or a repository-declared Docker Compose stack.
- Do not bypass verification merely because infrastructure was initially stopped.
- Do not invent or launch unrelated services that the repository does not indicate are required.

## Completion standard

Before considering a code change complete:

1. Inspect the final diff.
2. Run the relevant formatter check.
3. Run linting.
4. Run type checking when applicable.
5. Run relevant tests.
6. Run the build when applicable.
7. Review the final diff as if it had been written by another engineer and you were responsible for approving it for production.

If a verification step cannot be executed, state exactly what was not verified and why.

Never claim a change is verified when the relevant checks were not actually run.

## Reporting a finished change

A pass count is not evidence. A suite is green when nothing exercises the new behavior just
as surely as when everything does, so "all tests pass" tells the reader nothing about the
change they are being asked to trust.

When reporting a completed feature or fix, list the tests that cover it — each one by name,
with one line saying what it asserts and which broken behavior it would catch:

- Name every test added or changed, and say what each pins.
- Say plainly when a behavior is covered by no test, and why.
- Where a regression test was written, state that it was confirmed to fail before the fix.
- Report the counts last. They are context for the list, not a substitute for it.
