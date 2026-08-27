// Guards the naming contract between the shipped rules and uninstall.sh.
// install.sh copies every src/rules/*.md, but uninstall removes them by glob, so a rule
// named outside that glob would install and never uninstall.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RULES = fs.readdirSync(path.join(ROOT, 'src', 'rules'))

test('every shipped rule is named so uninstall removes it', () => {
  const orphaned = RULES.filter(name => !/^harness-.+\.md$/.test(name))
  assert.deepEqual(orphaned, [], 'rules outside the harness-*.md glob would survive uninstall')
})

test('uninstall removes rules by glob rather than by a list that goes stale', () => {
  const uninstall = fs.readFileSync(path.join(ROOT, 'uninstall.sh'), 'utf8')
  assert.match(uninstall, /rules\/harness-\*\.md/)
})

test('every rule declares the paths it applies to', () => {
  for (const name of RULES) {
    const body = fs.readFileSync(path.join(ROOT, 'src', 'rules', name), 'utf8')
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(body)
    assert.ok(frontmatter, `${name} has no frontmatter, so it would load in every session`)
    assert.match(frontmatter[1], /^paths:\n(\s+- ".+"\n?)+$/, `${name} has no usable paths list`)
  }
})
