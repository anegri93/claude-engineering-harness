// Round-trip tests for the two scripts that edit `~/.claude/settings.json`.
// Each case runs them as real subprocesses against a throwaway HOME, because the risk
// being covered is what they do to a user's existing file on disk.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const TOOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools')

function sandbox(t, initialSettings) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.mkdirSync(path.join(home, '.claude'))
  if (initialSettings !== undefined) {
    const body = typeof initialSettings === 'string' ? initialSettings : `${JSON.stringify(initialSettings, null, 2)}\n`
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), body)
  }
  return home
}

function settingsFile(home) {
  return path.join(home, '.claude', 'settings.json')
}

function run(home, script) {
  return execFileSync(process.execPath, [path.join(TOOLS, script)], {
    env: { ...process.env, HOME: home },
    encoding: 'utf8'
  })
}

const install = home => run(home, 'merge-settings.mjs')
const uninstall = home => run(home, 'remove-settings-hook.mjs')

function readSettings(home) {
  return JSON.parse(fs.readFileSync(settingsFile(home), 'utf8'))
}

const USER_HOOK = { matcher: 'Write', hooks: [{ type: 'command', command: '$HOME/mine.sh' }] }
const USER_SETTINGS = {
  model: 'claude-sonnet-5',
  effortLevel: 'low',
  permissions: { allow: ['Bash(git status)'] },
  hooks: { PostToolUse: [USER_HOOK] }
}

const harnessCommands = settings =>
  Object.values(settings.hooks ?? {})
    .flat()
    .flatMap(group => group.hooks ?? [])
    .map(hook => hook.command)
    .filter(command => command.startsWith('$HOME/.claude/hooks/'))

test('install applies the harness defaults and both hooks', t => {
  const home = sandbox(t, USER_SETTINGS)
  install(home)
  const settings = readSettings(home)

  assert.equal(settings.model, 'claude-opus-5')
  assert.equal(settings.effortLevel, 'high')
  assert.deepEqual(harnessCommands(settings).sort(), [
    '$HOME/.claude/hooks/mark-baseline-dirty.sh',
    '$HOME/.claude/hooks/verify-project.sh'
  ])
})

test('install is idempotent and never duplicates its hooks', t => {
  const home = sandbox(t, USER_SETTINGS)
  install(home)
  const once = fs.readFileSync(settingsFile(home), 'utf8')
  install(home)
  install(home)

  assert.equal(fs.readFileSync(settingsFile(home), 'utf8'), once)
  assert.equal(harnessCommands(readSettings(home)).length, 2)
})

test('install leaves unrelated settings and foreign hooks untouched', t => {
  const home = sandbox(t, USER_SETTINGS)
  install(home)
  const settings = readSettings(home)

  assert.deepEqual(settings.permissions, USER_SETTINGS.permissions)
  assert.ok(settings.hooks.PostToolUse.some(group => group.hooks?.[0]?.command === '$HOME/mine.sh'))
})

test('uninstall restores the model and effort the user had before installing', t => {
  const home = sandbox(t, USER_SETTINGS)
  install(home)
  uninstall(home)
  const settings = readSettings(home)

  assert.equal(settings.model, 'claude-sonnet-5')
  assert.equal(settings.effortLevel, 'low')
})

test('repeated installs still restore the values from before the first install', t => {
  const home = sandbox(t, USER_SETTINGS)
  install(home)
  install(home)
  install(home)
  uninstall(home)
  const settings = readSettings(home)

  assert.equal(settings.model, 'claude-sonnet-5')
  assert.equal(settings.effortLevel, 'low')
})

test('uninstall keeps a model the user chose after installing', t => {
  const home = sandbox(t, USER_SETTINGS)
  install(home)
  const chosen = readSettings(home)
  chosen.model = 'claude-haiku-4-5-20251001'
  fs.writeFileSync(settingsFile(home), `${JSON.stringify(chosen, null, 2)}\n`)
  uninstall(home)

  assert.equal(readSettings(home).model, 'claude-haiku-4-5-20251001')
})

test('install and uninstall round-trip a settings file back to its original content', t => {
  const home = sandbox(t, USER_SETTINGS)
  const before = fs.readFileSync(settingsFile(home), 'utf8')
  install(home)
  uninstall(home)

  assert.equal(fs.readFileSync(settingsFile(home), 'utf8'), before)
})

test('uninstall drops keys the user never had instead of leaving empty scaffolding', t => {
  const home = sandbox(t, { permissions: { allow: [] } })
  install(home)
  uninstall(home)
  const settings = readSettings(home)

  assert.deepEqual(settings, { permissions: { allow: [] } })
  assert.ok(!('hooks' in settings))
  assert.ok(!('model' in settings))
  assert.ok(!('effortLevel' in settings))
})

test('uninstall is idempotent', t => {
  const home = sandbox(t, USER_SETTINGS)
  install(home)
  uninstall(home)
  const once = fs.readFileSync(settingsFile(home), 'utf8')
  uninstall(home)

  assert.equal(fs.readFileSync(settingsFile(home), 'utf8'), once)
})

test('uninstall removes the state file it used to restore the defaults', t => {
  const home = sandbox(t, USER_SETTINGS)
  install(home)
  assert.ok(fs.existsSync(path.join(home, '.claude', 'harness-state.json')))
  uninstall(home)

  assert.ok(!fs.existsSync(path.join(home, '.claude', 'harness-state.json')))
})

test('a malformed settings file is reported and left byte-for-byte intact', t => {
  const malformed = '{ "model": "x",\n  // comment\n}\n'
  const home = sandbox(t, malformed)

  assert.throws(() => install(home), error => {
    assert.equal(error.status, 1)
    assert.match(error.stderr, /not valid JSON/)
    return true
  })
  assert.equal(fs.readFileSync(settingsFile(home), 'utf8'), malformed)
})

test('writes preserve the file permissions and leave no temporary files behind', t => {
  const home = sandbox(t, USER_SETTINGS)
  fs.chmodSync(settingsFile(home), 0o600)
  install(home)

  assert.equal(fs.statSync(settingsFile(home)).mode & 0o777, 0o600)
  assert.deepEqual(fs.readdirSync(path.join(home, '.claude')).filter(name => name.includes('tmp')), [])
})

test('an unwritable settings file fails without destroying the original', t => {
  const home = sandbox(t, USER_SETTINGS)
  const before = fs.readFileSync(settingsFile(home), 'utf8')
  const claude = path.join(home, '.claude')
  fs.chmodSync(claude, 0o500)
  try {
    assert.throws(() => install(home))
    assert.equal(fs.readFileSync(settingsFile(home), 'utf8'), before)
  } finally {
    // Restore here rather than in an `after` hook: those run in registration order, so
    // the sandbox cleanup would otherwise hit a directory it cannot empty.
    fs.chmodSync(claude, 0o700)
  }
})
