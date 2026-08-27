---
paths:
  - "**/workers/**"
  - "**/jobs/**"
  - "**/queues/**"
  - "**/*.worker.*"
  - "**/*.job.*"
---

# Background Job Rules

- Assume at-least-once delivery. A job must be safe to execute more than once.
- Make handlers idempotent by construction, keyed on stable business identity rather than on delivery metadata.
- Bound retries and apply backoff. Unbounded retries turn one failure into an outage.
- Route messages that can never succeed to a dead-letter path instead of retrying them forever.
- Checkpoint long-running work so an interrupted run resumes rather than restarting.
- Keep a unit of work small enough to finish inside its lease or visibility window.
- Bound concurrency and fan-out. A job that enqueues jobs needs an explicit ceiling.
- Handle partial success explicitly and record what completed before the failure.
- Do not rely on execution order between independent jobs.
- Make outcomes observable. Log job identity and result, not the full payload.
- Keep scheduling separate from the work itself so the work stays independently testable.
