# Changelog

## 6.0.0

- Added automatic local-environment preflight through `.claude/preflight.sh`.
- Verification now distinguishes environment failures from code/test failures.
- Supabase projects automatically start the local stack when it is configured but stopped.
- On macOS, the preflight can start Docker Desktop and wait for it to become ready.
- Repository-declared Docker Compose infrastructure can be started conservatively when project scripts explicitly reference Compose or `.claude/auto-compose` is present.
- Stop verification reuses the same preflight, so local infrastructure can recover automatically during normal Claude Code work.
- Added `HARNESS_AUTO_INFRA=0` to make infrastructure startup check-only, plus timeout environment variables for Docker and Supabase.
- Graft is now checked against npm during install and project initialization. The harness upgrades only when npm has a newer version and never downgrades a locally newer Graft build.
- Preserves a custom `.claude/preflight.sh`; only harness-generated preflight files are refreshed automatically.

## 5.0.0

- Added living engineering baselines with stable finding IDs.
- Added `.claude/engineering-baseline.json` as machine-readable finding state.
- Added a global PostToolUse hook that records files edited by Claude Code without calling a model.
- Extended the Stop quality gate so baseline refresh runs only after successful verification.
- Added incremental Graft + Claude Opus 5 high baseline revalidation.
- Existing findings can become OPEN, CHANGED, RESOLVED, or STALE.
- Incremental analysis can add concrete NEW findings from the changed blast radius.
- Unrelated findings are not re-audited on every task.
- Baseline refresh failures are fail-soft and retried later; verification failures remain blocking.
- Added full-reanalysis signaling when a change appears to materially alter project architecture.
- Added explicit global policy that baseline findings must never be treated as authoritative over current source and tests.
- Fixed project slug generation so archive directories no longer gain a trailing underscore from newline translation.

## 4.0.0

- Made Graft the standard repository-context layer.
- Added automatic Graft installation and per-project Claude integration.
- Set Claude Opus 5 with high effort as the default model configuration.
- Seeded semantic repository analysis with Graft map and focused context queries.
