import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const claudeDir = path.join(os.homedir(), '.claude')
const settingsPath = path.join(claudeDir, 'settings.json')
fs.mkdirSync(claudeDir, { recursive: true })

let settings = {}
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8').trim()
  if (raw) settings = JSON.parse(raw)
}

settings.model = 'claude-opus-5'
settings.effortLevel = 'high'
settings.hooks ??= {}
settings.hooks.Stop ??= []
settings.hooks.PostToolUse ??= []

function hasCommand(groups, command) {
  return groups.some(group => Array.isArray(group?.hooks) && group.hooks.some(h => h?.type === 'command' && h?.command === command))
}

const verifyCommand = '$HOME/.claude/hooks/verify-project.sh'
if (!hasCommand(settings.hooks.Stop, verifyCommand)) {
  settings.hooks.Stop.push({
    hooks: [{
      type: 'command',
      command: verifyCommand,
      timeout: 900,
      statusMessage: 'Verifying code and refreshing engineering baseline'
    }]
  })
}

const dirtyCommand = '$HOME/.claude/hooks/mark-baseline-dirty.sh'
if (!hasCommand(settings.hooks.PostToolUse, dirtyCommand)) {
  settings.hooks.PostToolUse.push({
    matcher: 'Write|Edit|MultiEdit|NotebookEdit',
    hooks: [{
      type: 'command',
      command: dirtyCommand,
      timeout: 10,
      statusMessage: 'Tracking engineering baseline impact'
    }]
  })
}

fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
console.log(`Updated ${settingsPath}`)
