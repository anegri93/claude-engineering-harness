#!/usr/bin/env bash
set -euo pipefail
CLAUDE_DIR="${HOME}/.claude"
IMPORT_LINE='@~/.claude/harness/engineering.md'
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Settings are restored before anything is deleted, for two reasons: this is the step that
# can fail for an environment reason, and the installed copy of the helper lives inside a
# directory the removal below wipes. Failing here leaves a working install rather than a
# half-removed one whose hooks point at scripts that are already gone.
REMOVE_SETTINGS=""
for candidate in "$SCRIPT_DIR/tools/remove-settings-hook.mjs" "$CLAUDE_DIR/harness-tools/remove-settings-hook.mjs"; do
  [[ -f "$candidate" ]] || continue
  REMOVE_SETTINGS="$candidate"
  break
done

SETTINGS_RESTORED=false
if ! command -v node >/dev/null 2>&1; then
  echo "WARNING: Node.js was not found, so ${CLAUDE_DIR}/settings.json was left unchanged." >&2
elif [[ -z "$REMOVE_SETTINGS" ]]; then
  echo "WARNING: remove-settings-hook.mjs was found in neither ${SCRIPT_DIR}/tools/ nor ${CLAUDE_DIR}/harness-tools/," >&2
  echo "so ${CLAUDE_DIR}/settings.json was left unchanged." >&2
else
  node "$REMOVE_SETTINGS"
  SETTINGS_RESTORED=true
fi

# Globbed rather than listed: a hardcoded list silently orphans every rule added later.
# The `harness-` prefix under rules/ is owned by this harness.
rm -f "$CLAUDE_DIR"/rules/harness-*.md \
      "$CLAUDE_DIR/agents/engineering-code-reviewer.md" \
      "$CLAUDE_DIR/hooks/verify-project.sh" \
      "$CLAUDE_DIR/hooks/mark-baseline-dirty.sh"
rm -rf "$CLAUDE_DIR/skills/engineering-review" "$CLAUDE_DIR/harness" "$CLAUDE_DIR/harness-tools" "$CLAUDE_DIR/harness-runtime"
if [[ -f "$CLAUDE_DIR/CLAUDE.md" ]]; then
  tmp="$(mktemp)"
  awk -v import="$IMPORT_LINE" '
    $0 == "# Global Engineering Harness" { next }
    $0 == import { next }
    { print }
  ' "$CLAUDE_DIR/CLAUDE.md" > "$tmp"
  mv "$tmp" "$CLAUDE_DIR/CLAUDE.md"
fi

echo "Harness files removed. Existing backups were preserved."
if [[ "$SETTINGS_RESTORED" != true ]]; then
  echo >&2
  echo "Uninstall is incomplete: the harness Stop and PostToolUse hooks and the model/effortLevel" >&2
  echo "defaults are still in ${CLAUDE_DIR}/settings.json, and those hooks now point at scripts that" >&2
  echo "were just removed. Remove them by hand, or rerun this script from a full clone of the" >&2
  echo "harness repository with Node.js available." >&2
fi
