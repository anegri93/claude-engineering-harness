// VERSION is the single source of truth for the release string. It was previously read by
// nothing while "v6" was restated in five places, including the banner the installer prints —
// so the file could say one thing and the user be told another, with nothing to catch it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const version = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim()

test('VERSION holds a single semantic version', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/, 'VERSION is not a bare semantic version')
})

test('VERSION matches the newest released CHANGELOG heading', () => {
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')
  // `## Unreleased` is deliberately skipped: it is where work accumulates before a release.
  const released = /^## (\d+\.\d+\.\d+)$/m.exec(changelog)
  assert.ok(released, 'CHANGELOG.md has no released version heading')
  assert.equal(
    version,
    released[1],
    'VERSION and the newest released CHANGELOG heading disagree, so the installer would announce a release that has no notes',
  )
})

test('the installer reports the version it read rather than a restated one', () => {
  const install = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8')
  assert.match(install, /HARNESS_VERSION="\$\(tr -d '\[:space:\]' < "\$SOURCE_DIR\/VERSION"\)"/)
  assert.match(install, /Harness \$\{HARNESS_VERSION\} installed/)
})

test('VERSION is installed so the project tools can report it', () => {
  const install = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8')
  assert.match(install, /install_file "\$SOURCE_DIR\/VERSION" "\$CLAUDE_DIR\/harness\/VERSION"/)
})

test('no shipped script restates a release number in prose', () => {
  // The rule is "derives from VERSION or does not exist". A hardcoded major like `v6` is the
  // form that went stale before: it survives a release because nothing reads it.
  const offenders = []
  for (const relative of ['install.sh', 'uninstall.sh', 'tools/init-project.sh', 'tools/refresh-baseline.sh', 'src/hooks/verify-project.sh', 'src/hooks/mark-baseline-dirty.sh']) {
    const body = fs.readFileSync(path.join(ROOT, relative), 'utf8')
    body.split('\n').forEach((line, i) => {
      if (/\bv\d+(\.\d+)*\b/.test(line) && !line.includes('VERSION')) {
        offenders.push(`${relative}:${i + 1}: ${line.trim()}`)
      }
    })
  }
  assert.deepEqual(offenders, [], 'a release number is restated instead of derived from VERSION')
})
