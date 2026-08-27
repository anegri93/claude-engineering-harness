#!/usr/bin/env bash
set -uo pipefail

PROJECT_ARG=""
FORCE=false
ANALYSIS_MODEL="${HARNESS_ANALYSIS_MODEL:-claude-opus-5}"
ANALYSIS_EFFORT="${HARNESS_ANALYSIS_EFFORT:-high}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ARG="${2:-}"; shift 2 ;;
    --force) FORCE=true; shift ;;
    --analysis-model) ANALYSIS_MODEL="${2:-}"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
Usage: refresh-baseline.sh [--project <path>] [--force] [--analysis-model <model>]

Normally invoked automatically by the harness Stop hook after successful verification.
It revalidates only findings affected by files edited during the Claude Code task and
checks the changed blast radius for concrete new engineering risks.
USAGE
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 64 ;;
  esac
done

CLAUDE_HOME="${HOME}/.claude"
HARNESS_HOME="${CLAUDE_HOME}/harness"
PROMPT_FILE="${HARNESS_HOME}/baseline-refresh-prompt.md"
SCHEMA_FILE="${HARNESS_HOME}/baseline-refresh-schema.json"
RENDERER="${CLAUDE_HOME}/harness-tools/render-baseline-refresh.mjs"

START_DIR="${PROJECT_ARG:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
[[ -d "$START_DIR" ]] || exit 0
if command -v git >/dev/null 2>&1 && git -C "$START_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  PROJECT_DIR="$(git -C "$START_DIR" rev-parse --show-toplevel)"
else
  PROJECT_DIR="$(cd "$START_DIR" && pwd -P)"
fi
cd "$PROJECT_DIR" 2>/dev/null || exit 0

[[ -f .claude/baseline-refresh-on-stop || "$FORCE" == true ]] || exit 0
BASELINE_JSON="$PROJECT_DIR/.claude/engineering-baseline.json"
BASELINE_MD="$PROJECT_DIR/.claude/engineering-baseline.md"
[[ -f "$BASELINE_JSON" && -f "$BASELINE_MD" ]] || exit 0
[[ -f "$PROMPT_FILE" && -f "$SCHEMA_FILE" && -f "$RENDERER" ]] || { echo "Baseline refresh components are missing; reinstall the harness." >&2; exit 0; }
command -v claude >/dev/null 2>&1 || { echo "Baseline refresh skipped: Claude Code CLI not found." >&2; exit 0; }
command -v node >/dev/null 2>&1 || { echo "Baseline refresh skipped: Node.js not found." >&2; exit 0; }

PROJECT_SLUG="$(printf '%s' "$(basename "$PROJECT_DIR")" | tr -cs 'A-Za-z0-9._-' '_')"
if command -v shasum >/dev/null 2>&1; then
  PROJECT_HASH="$(printf '%s' "$PROJECT_DIR" | shasum -a 256 | awk '{print substr($1,1,12)}')"
elif command -v sha256sum >/dev/null 2>&1; then
  PROJECT_HASH="$(printf '%s' "$PROJECT_DIR" | sha256sum | awk '{print substr($1,1,12)}')"
else
  PROJECT_HASH="nohash"
fi
STATE_DIR="${CLAUDE_HOME}/harness-runtime/${PROJECT_SLUG}_${PROJECT_HASH}"
DIRTY_FILE="$STATE_DIR/baseline-dirty"
CHANGED_FILE="$STATE_DIR/changed-files.txt"

if [[ "$FORCE" != true && ! -f "$DIRTY_FILE" ]]; then
  exit 0
fi

CHANGED_FILES=""
if [[ -f "$CHANGED_FILE" ]]; then
  CHANGED_FILES="$(sed '/^[[:space:]]*$/d' "$CHANGED_FILE" | sort -u | head -n 80)"
fi
if [[ -z "$CHANGED_FILES" && "$FORCE" == true ]] && command -v git >/dev/null 2>&1; then
  CHANGED_FILES="$({ git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u | head -n 80)"
fi
if [[ -z "$CHANGED_FILES" ]]; then
  rm -f "$DIRTY_FILE" "$CHANGED_FILE"
  exit 0
fi

# Ignore a task whose only edits were harness-generated files.
RELEVANT_FILES="$(printf '%s\n' "$CHANGED_FILES" | grep -Ev '^(\.claude/(engineering-baseline\.(md|json)|rules/|verify\.sh|verify-on-stop|baseline-refresh-on-stop)|graft/|node_modules/|dist/|build/|coverage/)' || true)"
if [[ -z "$RELEVANT_FILES" ]]; then
  rm -f "$DIRTY_FILE" "$CHANGED_FILE"
  exit 0
fi

GRAFT_CONTEXT=""
if command -v graft >/dev/null 2>&1; then
  FILES_INLINE="$(printf '%s' "$RELEVANT_FILES" | tr '\n' ' ' | cut -c1-3500)"
  GRAFT_CONTEXT="$(graft ask "Recent task changed these repository files: ${FILES_INLINE}. Identify affected modules, callers, contracts, business invariants, security boundaries, persistence behavior, and likely blast radius. Focus only on these changes." . 2>/dev/null || true)"
  GRAFT_CONTEXT="${GRAFT_CONTEXT:0:14000}"
fi

CURRENT_STATE="$(cat "$BASELINE_JSON")"
PROMPT="$(cat "$PROMPT_FILE")"
PROMPT+=$'\n\n## Files changed in this task\n\n```text\n'
PROMPT+="$RELEVANT_FILES"
PROMPT+=$'\n```\n\n## Current machine-readable baseline\n\n```json\n'
PROMPT+="$CURRENT_STATE"
PROMPT+=$'\n```\n'
if [[ -n "$GRAFT_CONTEXT" ]]; then
  PROMPT+=$'\n## Graft change-impact context\n\nTreat this as repository-derived navigation evidence and verify critical claims against source.\n\n'
  PROMPT+="$GRAFT_CONTEXT"
  PROMPT+=$'\n'
fi
PROMPT+=$'\nInspect only what is needed to revalidate affected findings and detect concrete new risks in the changed scope. Return only the requested structured output.\n'

SCHEMA_JSON="$(tr -d '\n' < "$SCHEMA_FILE")"
RESPONSE_FILE="$(mktemp -t harness-baseline-refresh.XXXXXX.json)"
ERROR_FILE="$(mktemp -t harness-baseline-refresh.XXXXXX.log)"
OUT_DIR="$(mktemp -d -t harness-baseline-render.XXXXXX)"
cleanup() { rm -f "$RESPONSE_FILE" "$ERROR_FILE"; rm -rf "$OUT_DIR"; }
trap cleanup EXIT

set +e
claude --safe-mode -p "$PROMPT" \
  --tools "Read,Glob,Grep" \
  --disallowedTools "mcp__*" \
  --permission-mode dontAsk \
  --append-system-prompt-file "${HARNESS_HOME}/engineering.md" \
  --model "$ANALYSIS_MODEL" \
  --effort "$ANALYSIS_EFFORT" \
  --max-turns 30 \
  --no-session-persistence \
  --output-format json \
  --json-schema "$SCHEMA_JSON" \
  >"$RESPONSE_FILE" 2>"$ERROR_FILE"
CLAUDE_EXIT=$?
set -e 2>/dev/null || true

if [[ $CLAUDE_EXIT -ne 0 ]]; then
  echo "Engineering baseline refresh deferred: Claude analysis failed. The baseline remains marked dirty for the next Stop." >&2
  tail -n 20 "$ERROR_FILE" >&2 || true
  exit 0
fi

set +e
RENDER_RESULT="$(node "$RENDERER" --current "$BASELINE_JSON" --response "$RESPONSE_FILE" --out "$OUT_DIR" 2>"$ERROR_FILE")"
RENDER_EXIT=$?
set -e 2>/dev/null || true
if [[ $RENDER_EXIT -ne 0 ]]; then
  echo "Engineering baseline refresh deferred: could not render the incremental analysis." >&2
  tail -n 20 "$ERROR_FILE" >&2 || true
  exit 0
fi

HAS_CHANGED="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(String(Boolean(x.changed)))' "$RENDER_RESULT")"
if [[ "$HAS_CHANGED" == "true" ]]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="${CLAUDE_HOME}/harness-baseline-backups/${PROJECT_SLUG}_${PROJECT_HASH}/${STAMP}"
  mkdir -p "$BACKUP_DIR"
  cp "$BASELINE_MD" "$BACKUP_DIR/engineering-baseline.md"
  cp "$BASELINE_JSON" "$BACKUP_DIR/engineering-baseline.json"
  cp "$OUT_DIR/engineering-baseline.md" "$BASELINE_MD"
  cp "$OUT_DIR/engineering-baseline.json" "$BASELINE_JSON"

  ARCHIVE_DIR="${CLAUDE_HOME}/harness-project-analysis/${PROJECT_SLUG}"
  mkdir -p "$ARCHIVE_DIR" 2>/dev/null || true
  cp "$BASELINE_JSON" "$ARCHIVE_DIR/latest-baseline.json" 2>/dev/null || true

  UPDATED="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(String(x.updated||0))' "$RENDER_RESULT")"
  RESOLVED="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(String(x.resolved||0))' "$RENDER_RESULT")"
  ADDED="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(String(x.added||0))' "$RENDER_RESULT")"
  CHANGED_COUNT="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(String(x.changed_findings||0))' "$RENDER_RESULT")"
  echo "Engineering baseline refreshed: ${UPDATED} updated, ${RESOLVED} resolved, ${CHANGED_COUNT} changed, ${ADDED} new."
else
  echo "Engineering baseline checked: no finding changes in this task's blast radius."
fi

FULL="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(String(Boolean(x.full_reanalysis_recommended)))' "$RENDER_RESULT")"
if [[ "$FULL" == "true" ]]; then
  REASON="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(x.summary||"")' "$RENDER_RESULT")"
  echo "Harness note: a full semantic reanalysis is recommended because the project architecture may have materially changed. ${REASON}" >&2
fi

rm -f "$DIRTY_FILE" "$CHANGED_FILE"
exit 0
