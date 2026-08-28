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

PROJECT_SLUG="$(printf '%s' "$(basename "$PROJECT_DIR")" | tr -cs 'A-Za-z0-9._-' '_')"
if command -v shasum >/dev/null 2>&1; then
  PROJECT_HASH="$(printf '%s' "$PROJECT_DIR" | shasum -a 256 | awk '{print substr($1,1,12)}')"
elif command -v sha256sum >/dev/null 2>&1; then
  PROJECT_HASH="$(printf '%s' "$PROJECT_DIR" | sha256sum | awk '{print substr($1,1,12)}')"
else
  PROJECT_HASH="nohash"
fi
STATE_DIR="${HOME}/.claude/harness-runtime/${PROJECT_SLUG}_${PROJECT_HASH}"

# Consent lives outside the repository, on purpose. This hook is installed globally, so it
# fires in every repository the user opens, including one they just cloned — and step three
# below executes a script the repository ships. Reading the enabling marker from inside that
# same repository meant a clone could grant the harness permission to run the clone's own
# code, with no action from the user beyond asking Claude a question. Only init-project.sh
# writes here, only after verification passed once, and a clone cannot reach it.
VERIFY_ENABLED=false
BASELINE_ENABLED=false
[[ -f "$STATE_DIR/verify-on-stop" ]] && VERIFY_ENABLED=true
[[ -f "$STATE_DIR/baseline-refresh-on-stop" ]] && BASELINE_ENABLED=true

if [[ "$VERIFY_ENABLED" != true && "$BASELINE_ENABLED" != true ]]; then
  # A project initialized before consent moved out of the repository would otherwise go quiet
  # with no explanation. The in-repo marker is reported, never honoured: honouring it is the
  # whole vulnerability. Printing on every Stop is deliberate and ends as soon as it is fixed.
  if [[ -f .claude/verify-on-stop || -f .claude/baseline-refresh-on-stop ]]; then
    echo "Engineering verification is NOT running in this project." >&2
    echo "It was enabled by a marker inside the repository, which the harness no longer trusts:" >&2
    echo "a cloned repository could use it to have its own .claude/verify.sh executed." >&2
    echo "Re-enable it for this project with: ~/.claude/harness-tools/init-project.sh" >&2
  fi
  exit 0
fi

TREE_CHANGED=true
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git diff --quiet --ignore-submodules -- 2>/dev/null \
    && git diff --cached --quiet --ignore-submodules -- 2>/dev/null \
    && [[ -z "$(git ls-files --others --exclude-standard 2>/dev/null)" ]]; then
    TREE_CHANGED=false
  fi
fi

# A clean tree is inconclusive, not proof that nothing happened: a task that edits files
# and then commits them ends clean, and that is precisely when the change is about to be
# pushed. The PostToolUse edit record is the harness's own account of what the task
# touched, so it decides when git cannot.
if [[ "$TREE_CHANGED" == false && -f "$STATE_DIR/baseline-dirty" ]]; then
  TREE_CHANGED=true
fi

# Exit-code contract, shared with the .claude/verify.sh this harness generates:
#   0             the checks ran and passed
#   3             no verification strategy applies to this project
#   127           a required command is not installed
#   anything else the checks ran and something is genuinely wrong
#
# Only the last case is the agent's problem. Reporting a stopped Docker daemon or a missing
# package manager as "fix the verification errors" sends the agent to repair code that is not
# broken, and no edit it can make will ever clear the block. That is how a gate stops being
# trusted and gets switched off, at which point the harness guarantees nothing at all. So a
# condition the environment owns is announced on every Stop and does not block.
report_environment() {
  local label="$1"
  local status="$2"
  local log_file="$3"

  echo "Engineering verification could not run: $label (exit $status)." >&2
  echo "This is an environment condition, not a defect in the change under review." >&2
  if [[ "$status" -eq 127 ]]; then
    echo "Install the missing command, then rerun: bash .claude/verify.sh" >&2
  else
    echo "Configure this project's checks in .claude/verify.sh, then rerun: bash .claude/verify.sh" >&2
  fi
  echo "--- verification output ---" >&2
  tail -n 40 "$log_file" >&2
}

run_and_report() {
  local label="$1"
  shift
  local log_file
  local status
  log_file="$(mktemp -t claude-verify.XXXXXX)"

  # Deliberately not `if "$@"`: the exit code has to be read, not just tested for zero.
  "$@" >"$log_file" 2>&1
  status=$?

  if [[ "$status" -eq 0 ]]; then
    rm -f "$log_file"
    return 0
  fi

  if [[ "$status" -eq 3 || "$status" -eq 127 ]]; then
    report_environment "$label" "$status" "$log_file"
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
      # Same contract as run_and_report: nothing was checked, so nothing can be reported as
      # broken. Announced every Stop rather than blocking, because no change to this
      # repository can install a package manager.
      echo "Engineering verification could not run: package.json declares a verify script," >&2
      echo "but no supported package manager (pnpm, yarn, bun, npm) is on PATH." >&2
      echo "This is an environment condition, not a defect in the change under review." >&2
    fi
  else
    echo "Engineering verification could not run: this project is enabled for Stop verification," >&2
    echo "but configures no verification command." >&2
    echo "Create .claude/verify.sh or add a package.json script named verify." >&2
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

# The edit record has two consumers. The baseline refresh clears it when it runs; when the
# refresh is not enabled, Stop verification is the last consumer and clears it here, so a
# later session that changed nothing keeps the no-op fast path.
if [[ "$BASELINE_ENABLED" != true ]]; then
  rm -f "$STATE_DIR/baseline-dirty" "$STATE_DIR/changed-files.txt" 2>/dev/null || true
fi

exit 0
