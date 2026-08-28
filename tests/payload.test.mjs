// The installable payload must be derived from the tree, not from a list inside install.sh.
// A hardcoded list fails in the passing direction: a file added under src/ or tools/ is
// committed, reviewed and documented, and then silently never reaches the user, with no error
// anywhere. These tests add a file to every payload directory, run the real install.sh and
// uninstall.sh against a throwaway HOME, and assert the file made the whole round trip.
//
// graft and npm are stubbed on PATH. Neither is the subject of this test, and install.sh
// exits 127 without them by design.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// One file per payload directory, each named so it also proves the ownership namespace is
// what gets pruned and removed rather than a hardcoded basename.
const ADDITIONS = [
  { source: 'src/harness/probe-prompt.md', installed: 'harness/probe-prompt.md' },
  { source: 'src/rules/harness-probe.md', installed: 'rules/harness-probe.md' },
  { source: 'src/agents/harness-probe-agent.md', installed: 'agents/harness-probe-agent.md' },
  { source: 'src/skills/harness-probe-skill/SKILL.md', installed: 'skills/harness-probe-skill/SKILL.md' },
  { source: 'src/hooks/probe-hook.sh', installed: 'hooks/probe-hook.sh' },
  { source: 'tools/probe-tool.mjs', installed: 'harness-tools/probe-tool.mjs' },
]

function sandbox(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-payload-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))

  const home = path.join(base, 'home')
  const repo = path.join(base, 'repo')
  const bin = path.join(base, 'bin')
  fs.mkdirSync(home)
  fs.mkdirSync(bin)
  fs.cpSync(ROOT, repo, {
    recursive: true,
    filter: src => !src.includes(`${path.sep}.git${path.sep}`) && !src.endsWith(`${path.sep}.git`),
  })

  fs.writeFileSync(path.join(bin, 'graft'), '#!/bin/sh\necho "graft 9.9.9"\n', { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\ncase "$1" in view) echo 9.9.9;; *) exit 0;; esac\n', { mode: 0o755 })

  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }
  const run = script => execFileSync('bash', [path.join(repo, script)], { cwd: repo, env, encoding: 'utf8' })

  return { home, repo, run }
}

function claudeFile(home, relative) {
  return path.join(home, '.claude', relative)
}

// Everything the harness owns, minus the two files it edits in place rather than creates.
function harnessFiles(home) {
  const claude = path.join(home, '.claude')
  if (!fs.existsSync(claude)) return []
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const relative = path.relative(claude, full)
      if (relative.startsWith('harness-backups')) continue
      if (entry.isDirectory()) walk(full)
      else if (relative !== 'settings.json' && relative !== 'CLAUDE.md') out.push(relative)
    }
  }
  walk(claude)
  return out.sort()
}

test('a file added to any payload directory is installed', t => {
  const box = sandbox(t)
  for (const addition of ADDITIONS) {
    const full = path.join(box.repo, addition.source)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, '# probe\n')
  }

  box.run('install.sh')

  for (const addition of ADDITIONS) {
    assert.equal(
      fs.existsSync(claudeFile(box.home, addition.installed)),
      true,
      `${addition.source} was committed to the payload but install.sh never copied it`,
    )
  }
})

test('a file added to any payload directory is also uninstalled', t => {
  const box = sandbox(t)
  for (const addition of ADDITIONS) {
    const full = path.join(box.repo, addition.source)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, '# probe\n')
  }

  box.run('install.sh')
  box.run('uninstall.sh')

  assert.deepEqual(harnessFiles(box.home), [], 'uninstall left harness files behind')
})

test('the stock payload round-trips with nothing left behind', t => {
  const box = sandbox(t)
  box.run('install.sh')
  const installed = harnessFiles(box.home)
  assert.ok(installed.length > 0, 'install.sh copied nothing')

  box.run('uninstall.sh')

  assert.deepEqual(harnessFiles(box.home), [], 'uninstall left harness files behind')
})

test('the executable bit is derived from the source file', t => {
  const box = sandbox(t)
  box.run('install.sh')

  // Hooks and the shell tools are executed directly; a lost +x makes them fail at Stop time.
  for (const relative of ['hooks/verify-project.sh', 'hooks/mark-baseline-dirty.sh', 'harness-tools/init-project.sh', 'harness-tools/refresh-baseline.sh']) {
    const mode = fs.statSync(claudeFile(box.home, relative)).mode
    assert.equal(Boolean(mode & 0o100), true, `${relative} is not executable`)
  }
  // A payload file that is not executable at source must not become executable on the way in.
  assert.equal(Boolean(fs.statSync(claudeFile(box.home, 'harness/engineering.md')).mode & 0o100), false)
})

test('reinstalling prunes a rule that upstream renamed or dropped', t => {
  const box = sandbox(t)
  box.run('install.sh')

  // Stand in for a rule that existed in an earlier release. Without pruning it keeps loading
  // as an instruction in every session forever, because nothing ever removes it.
  const orphan = claudeFile(box.home, 'rules/harness-dropped-upstream.md')
  fs.writeFileSync(orphan, '# from an older release\n')

  box.run('install.sh')

  assert.equal(fs.existsSync(orphan), false, 'a dropped rule survives every future reinstall')
})

test('reinstalling does not touch files outside the harness namespace', t => {
  const box = sandbox(t)
  box.run('install.sh')

  // rules/, agents/ and skills/ belong to the user too. Pruning must be scoped to the prefix.
  const mine = [
    claudeFile(box.home, 'rules/my-own-rule.md'),
    claudeFile(box.home, 'agents/my-own-agent.md'),
    claudeFile(box.home, 'skills/my-own-skill/SKILL.md'),
  ]
  for (const file of mine) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '# mine\n')
  }

  box.run('install.sh')
  for (const file of mine) {
    assert.equal(fs.existsSync(file), true, `install.sh deleted a user file: ${file}`)
  }

  box.run('uninstall.sh')
  for (const file of mine) {
    assert.equal(fs.existsSync(file), true, `uninstall.sh deleted a user file: ${file}`)
  }
})

test('upgrading from the pre-namespace layout leaves no second reviewer behind', t => {
  const box = sandbox(t)

  // What an older release installed, before the harness- prefix existed.
  const legacyAgent = claudeFile(box.home, 'agents/engineering-code-reviewer.md')
  const legacySkill = claudeFile(box.home, 'skills/engineering-review/SKILL.md')
  for (const file of [legacyAgent, legacySkill]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '# from v6\n')
  }

  box.run('install.sh')

  assert.equal(fs.existsSync(legacyAgent), false, 'the old reviewer agent still loads alongside the new one')
  assert.equal(fs.existsSync(legacySkill), false, 'the old review skill still loads alongside the new one')
  assert.equal(fs.existsSync(claudeFile(box.home, 'agents/harness-engineering-code-reviewer.md')), true)
  assert.equal(fs.existsSync(claudeFile(box.home, 'skills/harness-engineering-review/SKILL.md')), true)
})
