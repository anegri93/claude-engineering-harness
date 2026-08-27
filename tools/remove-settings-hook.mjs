import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
if (!fs.existsSync(settingsPath)) process.exit(0)
const raw = fs.readFileSync(settingsPath, 'utf8').trim()
if (!raw) process.exit(0)
const settings = JSON.parse(raw)

if (settings.model === 'claude-opus-5') delete settings.model
if (settings.effortLevel === 'high') delete settings.effortLevel

const commands = new Set([
  '$HOME/.claude/hooks/verify-project.sh',
  '$HOME/.claude/hooks/mark-baseline-dirty.sh'
])
for (const event of ['Stop', 'PostToolUse']) {
  if (!Array.isArray(settings?.hooks?.[event])) continue
  settings.hooks[event] = settings.hooks[event]
    .map(group => {
      if (!Array.isArray(group?.hooks)) return group
      return { ...group, hooks: group.hooks.filter(h => !(h?.type === 'command' && commands.has(h?.command))) }
    })
    .filter(group => !Array.isArray(group?.hooks) || group.hooks.length > 0)
}

fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
console.log(`Removed harness defaults and hooks from ${settingsPath}`)
