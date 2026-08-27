#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${CLAUDE_DIR}/harness-backups/${STAMP}"
mkdir -p "$CLAUDE_DIR" "$BACKUP_DIR"

graft_version() {
  local raw
  raw="$(graft --version 2>/dev/null || graft version 2>/dev/null || true)"
  printf '%s' "$raw" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?' | head -n 1
}

version_gt() {
  local a="$1" b="$2"
  [[ -n "$a" && -n "$b" ]] || return 1
  node -e '
    const a=process.argv[1].split(/[.-]/).slice(0,3).map(Number);
    const b=process.argv[2].split(/[.-]/).slice(0,3).map(Number);
    for(let i=0;i<3;i++){ if((a[i]||0)>(b[i]||0)) process.exit(0); if((a[i]||0)<(b[i]||0)) process.exit(1); }
    process.exit(1);
  ' "$a" "$b"
}

ensure_graft() {
  command -v npm >/dev/null 2>&1 || {
    if command -v graft >/dev/null 2>&1; then
      echo "Graft installed, but npm is unavailable so the harness cannot check for updates: $(graft_version || echo unknown)"
      return 0
    fi
    echo "ERROR: Graft is required, but npm was not found." >&2
    exit 127
  }

  local installed="" latest=""
  if command -v graft >/dev/null 2>&1; then
    installed="$(graft_version || true)"
  fi
  latest="$(npm view @nanonets/graft version --silent 2>/dev/null || true)"

  if [[ -z "$installed" ]]; then
    echo "Installing latest Graft repository-context layer..."
    npm install -g @nanonets/graft@latest
  elif [[ -n "$latest" ]] && version_gt "$latest" "$installed"; then
    echo "Updating Graft: ${installed} -> ${latest}"
    npm install -g @nanonets/graft@latest
  elif [[ -n "$latest" ]] && version_gt "$installed" "$latest"; then
    echo "Installed Graft ${installed} is newer than npm latest ${latest}; keeping installed version."
  elif [[ -n "$latest" ]]; then
    echo "Graft is current: ${installed}"
  else
    echo "Could not query the npm registry for the latest Graft version; keeping installed version ${installed}."
  fi

  command -v graft >/dev/null 2>&1 || { echo "ERROR: graft command is not in PATH." >&2; exit 127; }
}
ensure_graft

backup_if_exists() {
  local path="$1"
  if [[ -e "$path" ]]; then
    local relative="${path#${CLAUDE_DIR}/}"
    mkdir -p "$BACKUP_DIR/$(dirname "$relative")"
    cp -R "$path" "$BACKUP_DIR/$relative"
  fi
}
install_file() {
  local src="$1" dst="$2"
  backup_if_exists "$dst"
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
}

install_file "$SOURCE_DIR/src/harness/engineering.md" "$CLAUDE_DIR/harness/engineering.md"
install_file "$SOURCE_DIR/src/harness/project-analysis-prompt.md" "$CLAUDE_DIR/harness/project-analysis-prompt.md"
install_file "$SOURCE_DIR/src/harness/project-analysis-schema.json" "$CLAUDE_DIR/harness/project-analysis-schema.json"
install_file "$SOURCE_DIR/src/harness/baseline-refresh-prompt.md" "$CLAUDE_DIR/harness/baseline-refresh-prompt.md"
install_file "$SOURCE_DIR/src/harness/baseline-refresh-schema.json" "$CLAUDE_DIR/harness/baseline-refresh-schema.json"

for rule in "$SOURCE_DIR"/src/rules/*.md; do
  install_file "$rule" "$CLAUDE_DIR/rules/$(basename "$rule")"
done
install_file "$SOURCE_DIR/src/skills/engineering-review/SKILL.md" "$CLAUDE_DIR/skills/engineering-review/SKILL.md"
install_file "$SOURCE_DIR/src/agents/engineering-code-reviewer.md" "$CLAUDE_DIR/agents/engineering-code-reviewer.md"
install_file "$SOURCE_DIR/src/hooks/verify-project.sh" "$CLAUDE_DIR/hooks/verify-project.sh"
install_file "$SOURCE_DIR/src/hooks/mark-baseline-dirty.sh" "$CLAUDE_DIR/hooks/mark-baseline-dirty.sh"
chmod +x "$CLAUDE_DIR/hooks/verify-project.sh" "$CLAUDE_DIR/hooks/mark-baseline-dirty.sh"

mkdir -p "$CLAUDE_DIR/harness/project-template"
cp -R "$SOURCE_DIR/project-template/." "$CLAUDE_DIR/harness/project-template/"
mkdir -p "$CLAUDE_DIR/harness-tools"
for tool in init-project.sh refresh-baseline.sh render-project-analysis.mjs render-baseline-refresh.mjs remove-settings-hook.mjs; do
  install_file "$SOURCE_DIR/tools/$tool" "$CLAUDE_DIR/harness-tools/$tool"
done
chmod +x "$CLAUDE_DIR/harness-tools/init-project.sh" "$CLAUDE_DIR/harness-tools/refresh-baseline.sh" "$CLAUDE_DIR/harness-tools/render-project-analysis.mjs" "$CLAUDE_DIR/harness-tools/render-baseline-refresh.mjs"

GLOBAL_CLAUDE="$CLAUDE_DIR/CLAUDE.md"
IMPORT_LINE='@~/.claude/harness/engineering.md'
backup_if_exists "$GLOBAL_CLAUDE"
if [[ ! -f "$GLOBAL_CLAUDE" ]]; then
  printf '# Personal Claude Code Instructions\n\n%s\n' "$IMPORT_LINE" > "$GLOBAL_CLAUDE"
elif ! grep -Fqx "$IMPORT_LINE" "$GLOBAL_CLAUDE"; then
  printf '\n# Global Engineering Harness\n%s\n' "$IMPORT_LINE" >> "$GLOBAL_CLAUDE"
fi

backup_if_exists "$CLAUDE_DIR/settings.json"
if command -v node >/dev/null 2>&1; then
  node "$SOURCE_DIR/tools/merge-settings.mjs"
else
  echo "ERROR: Node.js is required to merge Claude Code settings." >&2
  exit 127
fi

echo
echo "Claude Engineering Harness v6 installed."
echo "Backup: $BACKUP_DIR"
echo "Restart Claude Code so hooks, skills, agents, model settings, and Graft wiring are reloaded."
echo "Default Claude model: claude-opus-5"
echo "Default effort: high"
echo "For a project: cd into the repo and run ~/.claude/harness-tools/init-project.sh"
echo "v6 adds automatic local-environment preflight before verification and keeps Graft updated to the latest available release. The living baseline remains automatic after verified edits."
