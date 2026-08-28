// `claude-opus-5` / `high` appear in several files. Only HARNESS_DEFAULTS is authoritative;
// the rest are copies that drift silently, and settings-hook-snippet.json is what a user
// copies by hand when they wire the harness up without running the installer. These tests
// pin every machine-readable copy to the source of truth.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { HARNESS_DEFAULTS } from '../tools/settings-io.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNIPPET = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings-hook-snippet.json'), 'utf8'))

function read(...relative) {
  return fs.readFileSync(path.join(ROOT, ...relative), 'utf8')
}

test('the hand-copied snippet applies the same defaults the installer does', () => {
  for (const [key, value] of Object.entries(HARNESS_DEFAULTS)) {
    assert.equal(SNIPPET[key], value,
      `settings-hook-snippet.json sets ${key} to ${SNIPPET[key]}, but the installer applies ${value}`)
  }
})

test('the hand-copied snippet wires the same hooks the installer does', t => {
  // Run the real installer against a throwaway HOME rather than restating its hook objects
  // here, which would add a third copy to keep in sync.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-defaults-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.mkdirSync(path.join(home, '.claude'))
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'merge-settings.mjs')], {
    env: { ...process.env, HOME: home },
    stdio: 'pipe'
  })
  const installed = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))

  assert.deepEqual(SNIPPET.hooks, installed.hooks,
    'settings-hook-snippet.json and merge-settings.mjs disagree about the harness hooks')
})

test('the snippet claims nothing the installer does not apply', () => {
  // A key only in the snippet is a setting a hand-wiring user gets and an installing user
  // does not — the drift is invisible until the two behave differently.
  const managed = new Set([...Object.keys(HARNESS_DEFAULTS), 'hooks'])
  const extra = Object.keys(SNIPPET).filter(key => !managed.has(key))
  assert.deepEqual(extra, [], 'settings-hook-snippet.json carries keys the harness does not manage')
})

// The shell scripts pick the model for their own Claude invocations. They cannot import the
// ESM module, so the literal is duplicated; this pins it rather than letting it rot.
const SHELL_DEFAULTS = [
  ['tools/init-project.sh', 'HARNESS_ANALYSIS_MODEL', HARNESS_DEFAULTS.model],
  ['tools/init-project.sh', 'HARNESS_ANALYSIS_EFFORT', HARNESS_DEFAULTS.effortLevel],
  ['tools/refresh-baseline.sh', 'HARNESS_ANALYSIS_MODEL', HARNESS_DEFAULTS.model],
  ['tools/refresh-baseline.sh', 'HARNESS_ANALYSIS_EFFORT', HARNESS_DEFAULTS.effortLevel]
]

for (const [file, variable, expected] of SHELL_DEFAULTS) {
  test(`${file} falls back to the harness default for ${variable}`, () => {
    const match = new RegExp(`\\\$\\{${variable}:-([^}]+)\\}`).exec(read(file))
    assert.ok(match, `${file} no longer declares a ${variable} fallback`)
    assert.equal(match[1], expected,
      `${file} falls back to ${match[1]}, but the harness default is ${expected}`)
  })
}

test('install.sh reports the defaults it applied instead of restating them', () => {
  const body = read('install.sh')
  assert.ok(!body.includes(`Default Claude model: ${HARNESS_DEFAULTS.model}`),
    'install.sh hardcodes the model in its completion output, so it can report one it did not apply')
  assert.match(body, /HARNESS_DEFAULTS/,
    'install.sh no longer derives its reported defaults from the source of truth')
})
