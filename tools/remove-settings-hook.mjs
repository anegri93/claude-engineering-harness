import fs from 'node:fs'
import {
  HARNESS_DEFAULTS,
  MANAGED_DEFAULT_KEYS,
  readJsonFile,
  runScript,
  settingsPath,
  statePath,
  writeJsonFileAtomic
} from './settings-io.mjs'

const HARNESS_COMMANDS = new Set([
  '$HOME/.claude/hooks/verify-project.sh',
  '$HOME/.claude/hooks/mark-baseline-dirty.sh'
])

function restorePreviousDefaults(settings) {
  // Absent state means the pre-install values were never recorded, so the best that can
  // be done is to drop the defaults the harness applied.
  const previous = readJsonFile(statePath())?.previousDefaults ?? {}
  for (const key of MANAGED_DEFAULT_KEYS) {
    // Only reverse the harness's own value. Anything the user chose after installing is
    // a deliberate decision and must survive the uninstall.
    if (settings[key] !== HARNESS_DEFAULTS[key]) continue
    const before = previous[key] ?? null
    if (before === null) delete settings[key]
    else settings[key] = before
  }
}

function removeHarnessHooks(settings) {
  for (const event of ['Stop', 'PostToolUse']) {
    if (!Array.isArray(settings?.hooks?.[event])) continue
    settings.hooks[event] = settings.hooks[event]
      .map(group => {
        if (!Array.isArray(group?.hooks)) return group
        return { ...group, hooks: group.hooks.filter(h => !(h?.type === 'command' && HARNESS_COMMANDS.has(h?.command))) }
      })
      .filter(group => !Array.isArray(group?.hooks) || group.hooks.length > 0)
    // Drop containers the harness itself created, so uninstall leaves no empty scaffolding.
    if (settings.hooks[event].length === 0) delete settings.hooks[event]
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks
}

runScript(() => {
  const target = settingsPath()
  const settings = readJsonFile(target)
  if (settings === null) return

  restorePreviousDefaults(settings)
  removeHarnessHooks(settings)

  writeJsonFileAtomic(target, settings)
  // The state exists only while settings still need restoring.
  fs.rmSync(statePath(), { force: true })
  console.log(`Removed harness defaults and hooks from ${target}`)
})
