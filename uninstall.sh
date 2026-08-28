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

# Globbed rather than listed: a hardcoded list silently orphans every file added later.
# `harness-` under rules/, agents/ and skills/ is this harness's namespace inside directories
# the user also owns, so removing the namespace removes exactly what was installed. The two
# unprefixed names are what the harness shipped before the namespace existed, and are removed
# so uninstalling after an upgrade does not leave them behind.
rm -f "$CLAUDE_DIR"/rules/harness-*.md \
      "$CLAUDE_DIR"/agents/harness-*.md \
      "$CLAUDE_DIR/agents/engineering-code-reviewer.md"
rm -rf "$CLAUDE_DIR"/skills/harness-* "$CLAUDE_DIR/skills/engineering-review"

# hooks/ is not namespaced, so it is derived from the repository this script ships in: the
# same tree install.sh copied from. Removing a hook by a list here would orphan every hook
# added later, which is the failure this whole change exists to close.
for hook in "$SCRIPT_DIR"/src/hooks/*.sh; do
  [[ -f "$hook" ]] || continue
  rm -f "$CLAUDE_DIR/hooks/$(basename "$hook")"
done

rm -rf "$CLAUDE_DIR/harness" "$CLAUDE_DIR/harness-tools" "$CLAUDE_DIR/harness-runtime"
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
