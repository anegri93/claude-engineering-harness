#!/usr/bin/env bash
set -euo pipefail

# Customize this file for the project when automatic detection is not enough.
# For Node projects it prepares local verification infrastructure first, then runs the strongest existing checks in a stable order.

if [[ "${HARNESS_PREFLIGHT_DONE:-0}" != "1" && -x .claude/preflight.sh ]]; then
  echo "==> environment preflight"
  .claude/preflight.sh
fi

if [[ ! -f package.json ]]; then
  echo "Customize .claude/verify.sh for this non-Node project." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node is required to inspect package.json." >&2
  exit 1
fi

if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null 2>&1; then
  RUN=(pnpm run)
elif [[ -f yarn.lock ]] && command -v yarn >/dev/null 2>&1; then
  RUN=(yarn)
elif [[ -f bun.lockb || -f bun.lock ]] && command -v bun >/dev/null 2>&1; then
  RUN=(bun run)
elif command -v npm >/dev/null 2>&1; then
  RUN=(npm run)
else
  echo "No supported package manager found." >&2
  exit 1
fi

has_script() {
  SCRIPT_NAME="$1" node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts[process.env.SCRIPT_NAME] ? 0 : 1)"
}

run_script() {
  local script="$1"
  if has_script "$script"; then
    echo "==> $script"
    "${RUN[@]}" "$script"
  fi
}

# Non-mutating checks first. Customize names if your project uses different scripts.
run_script "fmt:check"
run_script "format:check"
run_script "lint"

if has_script "typecheck"; then
  run_script "typecheck"
elif has_script "test:types"; then
  run_script "test:types"
fi

run_script "test"
run_script "build"
