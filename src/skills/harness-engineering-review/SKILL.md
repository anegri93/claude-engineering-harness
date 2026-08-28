---
name: harness-engineering-review
description: Performs a production-readiness review of code changes for correctness, security, maintainability, scalability, and test quality. Use after significant implementations, refactors, bug fixes, or when asked to review a diff or code quality.
effort: high
---

# Engineering Review

Review the actual changed code and its surrounding contracts. Inspect the current diff when available.

## Correctness

Look for concrete risks such as:

- incorrect assumptions
- missing edge cases
- invalid or inconsistent states
- race conditions
- concurrency errors
- partial failure handling
- unbounded retries or waits
- idempotency problems
- stale or duplicated state

## Security

Look for concrete risks such as:

- unvalidated external input
- missing authorization
- excessive privilege
- secret or sensitive-data exposure
- injection risks
- unsafe dynamic execution
- insecure defaults
- dependency risk introduced by the change

## Maintainability

Look for:

- unnecessary complexity
- excessive coupling
- unclear responsibilities
- meaningful duplication
- premature abstractions
- hidden dependencies
- poor naming
- dead code
- unrelated changes mixed into the diff
- divergence from established project architecture without justification

## Scalability and operations

Look for:

- avoidable N+1 or unbounded work
- uncontrolled fan-out
- resource leaks
- missing timeouts on external calls
- unnecessary infrastructure complexity
- state or coordination assumptions that fail under concurrent execution

Do not invent performance problems without evidence or a clear asymptotic risk.

## Testing

Determine whether tests cover the actual risk introduced by the change.

Prefer tests for:

- business invariants
- regressions
- edge cases
- failure paths
- important integrations
- concurrency behavior when relevant

Do not request tests merely to increase coverage.

## Output

Report only actionable findings.

Classify each finding as:

- critical
- important
- improvement

For each finding, identify the affected location, explain the concrete failure mode, and recommend the smallest appropriate correction.

If the implementation is already appropriate, say so. Do not manufacture findings to fill categories.
