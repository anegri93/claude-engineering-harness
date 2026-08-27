// Shared filesystem helpers for the scripts that edit `~/.claude/settings.json`.
// Dependency-free on purpose: install and uninstall must work with a bare Node runtime.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HARNESS_DEFAULTS = { model: 'claude-opus-5', effortLevel: 'high' }
export const MANAGED_DEFAULT_KEYS = Object.keys(HARNESS_DEFAULTS)

export function claudeDir() {
  return path.join(os.homedir(), '.claude')
}

export function settingsPath() {
  return path.join(claudeDir(), 'settings.json')
}

// Kept outside `~/.claude/harness/`, which uninstall deletes before it restores settings.
export function statePath() {
  return path.join(claudeDir(), 'harness-state.json')
}

export function readJsonFile(file) {
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`${file} is not valid JSON, so it was left untouched: ${error.message}`)
  }
}

// Write to a sibling temporary file and rename over the target. Rename is atomic within a
// filesystem, so an interrupted or failing write can never truncate the caller's settings.
export function writeJsonFileAtomic(file, value) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`)
  const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode })
    fs.chmodSync(tmp, mode)
    fs.renameSync(tmp, file)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

// Runs `main`, reporting expected failures as a single message instead of a stack trace.
export function runScript(main) {
  try {
    main()
  } catch (error) {
    console.error(`ERROR: ${error.message}`)
    process.exit(1)
  }
}
