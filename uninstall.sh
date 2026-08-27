#!/usr/bin/env bash
set -euo pipefail
CLAUDE_DIR="${HOME}/.claude"
IMPORT_LINE='@~/.claude/harness/engineering.md'
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
if command -v node >/dev/null 2>&1; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  [[ -f "$SCRIPT_DIR/tools/remove-settings-hook.mjs" ]] && node "$SCRIPT_DIR/tools/remove-settings-hook.mjs"
fi
echo "Harness files removed. Existing backups were preserved."
