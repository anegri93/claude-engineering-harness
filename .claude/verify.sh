#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [[ "${HARNESS_PREFLIGHT_DONE:-0}" != "1" && -x .claude/preflight.sh ]]; then echo "==> environment preflight"; .claude/preflight.sh; fi

_dockerfiles="$(find . \( -name node_modules -o -name .git \) -prune -o -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.dockerfile' \) -print 2>/dev/null)"
if [[ -n "$_dockerfiles" ]]; then
  if command -v hadolint >/dev/null 2>&1; then
    echo "==> hadolint"
    # hadolint fails on info-level findings by default, which fails a correct Dockerfile
    # and trains everyone to disable the gate. Warning and above is the useful signal.
    _hadolint_threshold="${HARNESS_HADOLINT_THRESHOLD:-warning}"
    _hadolint_failed=0
    while IFS= read -r _dockerfile; do
      [[ -n "$_dockerfile" ]] || continue
      hadolint --failure-threshold "$_hadolint_threshold" "$_dockerfile" || _hadolint_failed=1
    done <<< "$_dockerfiles"
    [[ $_hadolint_failed -eq 0 ]] || exit 1
  else
    echo "==> hadolint not installed; Dockerfile lint skipped" >&2
  fi
fi
command -v node >/dev/null 2>&1 || { echo "Required command not found: node" >&2; exit 127; }
echo "==> node --test"
node --test
