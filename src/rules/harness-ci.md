---
paths:
  - "**/.github/workflows/*.yml"
  - "**/.github/workflows/*.yaml"
  - "**/.gitlab-ci.yml"
---

# Continuous Integration Rules

- Pin the versions of actions and tools the pipeline depends on, so what CI validates cannot change without a commit.
- Grant a workflow the minimum permissions it needs.
- Never echo a secret, and never expose one to a workflow that untrusted contributors can trigger.
- Let a real failure fail the build. Do not swallow an exit code to keep the pipeline green.
- Keep CI aligned with local verification so a passing local run predicts a passing pipeline.
- Cover the versions the project actually claims to support, and no more.
- Keep jobs deterministic and independent of execution order or shared mutable state.
- Key caches on the lockfile and make sure a stale cache cannot hide a broken install.
- Keep run time proportional to the signal a check provides.
- Treat the workflow as production code. Review it, and do not disable a check to unblock a merge.
