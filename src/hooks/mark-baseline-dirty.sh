#!/usr/bin/env bash
set -uo pipefail

INPUT="$(cat || true)"

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$PROJECT_DIR" ]] && command -v node >/dev/null 2>&1; then
  PROJECT_DIR="$(printf '%s' "$INPUT" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
      try { const x=JSON.parse(s||"{}"); process.stdout.write(String(x.cwd||"")); } catch {}
    })
  ' 2>/dev/null || true)"
fi
[[ -n "$PROJECT_DIR" ]] || PROJECT_DIR="$(pwd)"

if command -v git >/dev/null 2>&1 && git -C "$PROJECT_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  PROJECT_DIR="$(git -C "$PROJECT_DIR" rev-parse --show-toplevel)"
fi
cd "$PROJECT_DIR" 2>/dev/null || exit 0

# The edit record feeds two consumers: the incremental baseline refresh, and the Stop
# verification gate, which consults it when git reports a clean tree because the task
# committed its own work. Record edits whenever either consumer is enabled.
TRACK=false
[[ -f .claude/verify-on-stop ]] && TRACK=true
[[ -f .claude/baseline-refresh-on-stop && -f .claude/engineering-baseline.json ]] && TRACK=true
[[ "$TRACK" == true ]] || exit 0

FILE_PATH=""
if command -v node >/dev/null 2>&1; then
  FILE_PATH="$(printf '%s' "$INPUT" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
      try {
        const x=JSON.parse(s||"{}");
        const i=x.tool_input||{};
        process.stdout.write(String(i.file_path||i.notebook_path||i.path||""));
      } catch {}
    })
  ' 2>/dev/null || true)"
fi

# A PostToolUse event without a concrete edit target is not useful for incremental refresh.
[[ -n "$FILE_PATH" ]] || exit 0

if [[ "$FILE_PATH" = /* ]]; then
  # The project root comes from git and is therefore physical, while the event carries the
  # path as the tool used it. Compare like with like, or every edit under a symlinked
  # ancestor is silently discarded as being outside the repository.
  FILE_DIR="$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd -P)" || FILE_DIR=""
  [[ -n "$FILE_DIR" ]] && FILE_PATH="${FILE_DIR}/$(basename "$FILE_PATH")"
  case "$FILE_PATH" in
    "$PROJECT_DIR"/*) REL_PATH="${FILE_PATH#"$PROJECT_DIR"/}" ;;
    *) exit 0 ;;
  esac
else
  REL_PATH="${FILE_PATH#./}"
fi

# Harness bookkeeping and build output are not engineering changes. This list is mirrored
# as a grep -Ev regex in tools/refresh-baseline.sh, which re-filters defensively for --force
# runs; change one and change the other. tests/hooks.test.mjs asserts the two agree.
case "$REL_PATH" in
  .claude/engineering-baseline.md|.claude/engineering-baseline.json|.claude/rules/*|.claude/verify.sh|.claude/verify-on-stop|.claude/baseline-refresh-on-stop|graft/*|node_modules/*|dist/*|build/*|coverage/*)
    exit 0
    ;;
esac

PROJECT_SLUG="$(printf '%s' "$(basename "$PROJECT_DIR")" | tr -cs 'A-Za-z0-9._-' '_')"
if command -v shasum >/dev/null 2>&1; then
  PROJECT_HASH="$(printf '%s' "$PROJECT_DIR" | shasum -a 256 | awk '{print substr($1,1,12)}')"
elif command -v sha256sum >/dev/null 2>&1; then
  PROJECT_HASH="$(printf '%s' "$PROJECT_DIR" | sha256sum | awk '{print substr($1,1,12)}')"
else
  PROJECT_HASH="nohash"
fi
STATE_DIR="${HOME}/.claude/harness-runtime/${PROJECT_SLUG}_${PROJECT_HASH}"
mkdir -p "$STATE_DIR"
touch "$STATE_DIR/baseline-dirty"
printf '%s\n' "$REL_PATH" >> "$STATE_DIR/changed-files.txt"
# Keep it compact and deterministic.
sort -u "$STATE_DIR/changed-files.txt" -o "$STATE_DIR/changed-files.txt" 2>/dev/null || true
exit 0
