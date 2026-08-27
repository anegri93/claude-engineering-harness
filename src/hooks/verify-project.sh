#!/usr/bin/env bash
set -uo pipefail

INPUT="$(cat || true)"

# Avoid recursive Stop-hook execution if Claude Code is already reacting to a Stop hook.
if printf '%s' "$INPUT" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0
if command -v git >/dev/null 2>&1 && git rev-parse --show-toplevel >/dev/null 2>&1; then
  PROJECT_DIR="$(git rev-parse --show-toplevel)"
  cd "$PROJECT_DIR" 2>/dev/null || exit 0
fi

VERIFY_ENABLED=false
BASELINE_ENABLED=false
[[ -f .claude/verify-on-stop ]] && VERIFY_ENABLED=true
[[ -f .claude/baseline-refresh-on-stop ]] && BASELINE_ENABLED=true
[[ "$VERIFY_ENABLED" == true || "$BASELINE_ENABLED" == true ]] || exit 0

TREE_CHANGED=true
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git diff --quiet --ignore-submodules -- 2>/dev/null \
    && git diff --cached --quiet --ignore-submodules -- 2>/dev/null \
    && [[ -z "$(git ls-files --others --exclude-standard 2>/dev/null)" ]]; then
    TREE_CHANGED=false
  fi
fi

run_and_report() {
  local label="$1"
  shift
  local log_file
  log_file="$(mktemp -t claude-verify.XXXXXX)"

  if "$@" >"$log_file" 2>&1; then
    rm -f "$log_file"
    return 0
  fi

  echo "Engineering verification failed during: $label" >&2
  echo "Fix the verification errors before completing the task." >&2
  echo "--- verification output ---" >&2
  tail -n 120 "$log_file" >&2
  rm -f "$log_file"
  exit 2
}

if [[ "$VERIFY_ENABLED" == true && "$TREE_CHANGED" == true ]]; then
  if [[ -f .claude/verify.sh ]]; then
    run_and_report ".claude/verify.sh" bash .claude/verify.sh
  elif [[ -f package.json ]] && command -v node >/dev/null 2>&1 \
    && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.verify ? 0 : 1)" >/dev/null 2>&1; then
    if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null 2>&1; then
      run_and_report "pnpm verify" pnpm verify
    elif [[ -f yarn.lock ]] && command -v yarn >/dev/null 2>&1; then
      run_and_report "yarn verify" yarn verify
    elif [[ -f bun.lockb || -f bun.lock ]] && command -v bun >/dev/null 2>&1; then
      run_and_report "bun run verify" bun run verify
    elif command -v npm >/dev/null 2>&1; then
      run_and_report "npm run verify" npm run verify
    else
      echo "Stop verification is enabled, but no supported package manager is available." >&2
      exit 2
    fi
  else
    echo "Stop verification is enabled by .claude/verify-on-stop, but no verification command is configured." >&2
    echo "Create .claude/verify.sh or add a package.json script named verify." >&2
    exit 2
  fi
fi

# Baseline maintenance is deliberately after successful verification. It is advisory:
# refresh failures leave the dirty marker for the next Stop but do not block completion.
if [[ "$BASELINE_ENABLED" == true ]]; then
  REFRESH="$HOME/.claude/harness-tools/refresh-baseline.sh"
  if [[ -x "$REFRESH" ]]; then
    "$REFRESH" --project "$PROJECT_DIR" || true
  fi
fi

exit 0
