---
paths:
  - "**/*.sh"
  - "**/*.bash"
---

# Shell Script Rules

- Start with `set -euo pipefail` so a failing command stops the script instead of continuing on bad state.
- Quote every expansion. An unquoted path breaks on spaces and expands as a glob.
- Quote expansions nested inside parameter expansion as well, or they are matched as patterns rather than literals.
- Verify a required command exists before using it and fail with a message that says what is missing.
- Create temporary files with `mktemp` and remove them through a trap on EXIT.
- Replace an important file by writing a temporary file and renaming over the target, so an interrupted write cannot truncate it.
- Iterate globs or `find -print0`. Do not parse `ls`.
- Never build a path for a destructive command from an unvalidated variable.
- Send diagnostics to stderr and leave stdout for output the caller consumes.
- Return meaningful exit codes and do not mask a failure to keep a pipeline quiet.
- Prefer `[[ ]]` over `[ ]` in bash, and prefer explicit comparisons over relying on empty-string behavior.
