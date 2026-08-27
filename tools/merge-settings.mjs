import {
  HARNESS_DEFAULTS,
  MANAGED_DEFAULT_KEYS,
  readJsonFile,
  runScript,
  settingsPath,
  statePath,
  writeJsonFileAtomic
} from './settings-io.mjs'

function rememberPreviousDefaults(settings) {
  const state = readJsonFile(statePath()) ?? {}
  // Record what the user had before the *first* install. A repeat install must not
  // overwrite this with the harness defaults it applied last time, or uninstall would
  // have nothing to restore. `null` records that the key was absent.
  if (state.previousDefaults) return
  state.previousDefaults = Object.fromEntries(
    MANAGED_DEFAULT_KEYS.map(key => [key, key in settings ? settings[key] : null])
  )
  writeJsonFileAtomic(statePath(), state)
}

function hasCommand(groups, command) {
  return groups.some(group => Array.isArray(group?.hooks) && group.hooks.some(h => h?.type === 'command' && h?.command === command))
}

runScript(() => {
  const target = settingsPath()
  const settings = readJsonFile(target) ?? {}

  rememberPreviousDefaults(settings)
  Object.assign(settings, HARNESS_DEFAULTS)

  settings.hooks ??= {}
  settings.hooks.Stop ??= []
  settings.hooks.PostToolUse ??= []

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

  writeJsonFileAtomic(target, settings)
  console.log(`Updated ${target}`)
})
