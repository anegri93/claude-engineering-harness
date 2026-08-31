// What makes the baseline refresh decide there is something to look at.
//
// The refresh used to read exactly one source: the PostToolUse edit record written by
// mark-baseline-dirty.sh, which Claude Code only fires for Write/Edit/MultiEdit/NotebookEdit.
// A task that edits through Bash — a heredoc, `sed -i`, a python one-liner — leaves that record
// empty, and the refresh exited as though the session had changed nothing.
//
// That is not hypothetical. In one observed session the Stop hook ran nine times over 90
// minutes while three baseline findings were fixed, verified and covered by regression tests;
// `changed-files.txt` was never created, the refresh exited in milliseconds every time, and the
// baseline still reported all three as `open` the next day. Nothing printed. The failure mode
// is a check that never ran, which is the only kind this repository is really afraid of.
//
// Claude is stubbed. What is under test is whether the refresh reaches the model call at all,
// and whether the cheap "nothing moved" fast path still holds afterwards.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const REFRESH = path.join(ROOT, 'tools', 'refresh-baseline.sh')

function have(command) {
  try {
    execFileSync('bash', ['-c', `command -v ${command}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const skip = !have('git') && 'git is unavailable'

const BASELINE = {
  version: 2,
  system_summary: 'Fixture.',
  architecture_summary: 'Fixture.',
  business_invariants: [],
  confidence_notes: [],
  findings: [{
    id: 'F001',
    status: 'open',
    impact: 'security',
    trigger: 'normal_use',
    blast_radius: 'component',
    fix_cost: 'single_site',
    severity: 'high',
    title: 'The origin check passes when both headers are absent',
    detail: 'Fixture detail.',
    example: 'Fixture example.',
    evidence_paths: ['src/thing.ts'],
    recommendation: 'Fixture recommendation.',
    resolution: '',
  }],
  next_finding_id: 2,
  full_reanalysis_recommended: false,
  full_reanalysis_reason: '',
}

// Records every invocation, then emits the shape `--output-format json` produces.
const CLAUDE_STUB = `#!/bin/sh
echo "called" >> "$STUB_CALL_LOG"
cat "$STUB_RESPONSE"
exit 0
`

function makeWorld(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refresh-home-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refresh-project-'))
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refresh-bin-'))
  t.after(() => {
    for (const dir of [home, project, bin]) fs.rmSync(dir, { recursive: true, force: true })
  })

  const harness = path.join(home, '.claude', 'harness')
  const tools = path.join(home, '.claude', 'harness-tools')
  fs.mkdirSync(harness, { recursive: true })
  fs.mkdirSync(tools, { recursive: true })
  fs.writeFileSync(path.join(harness, 'engineering.md'), '# standard\n')
  fs.copyFileSync(path.join(ROOT, 'src', 'harness', 'baseline-refresh-prompt.md'), path.join(harness, 'baseline-refresh-prompt.md'))
  fs.copyFileSync(path.join(ROOT, 'src', 'harness', 'baseline-refresh-schema.json'), path.join(harness, 'baseline-refresh-schema.json'))
  for (const name of ['render-baseline-refresh.mjs', 'severity.mjs']) {
    fs.copyFileSync(path.join(ROOT, 'tools', name), path.join(tools, name))
  }

  // A refresh that reports no change writes nothing, which keeps the assertions about "did the
  // model get called" independent of what the model would have said.
  const response = path.join(home, 'response.json')
  fs.writeFileSync(response, JSON.stringify({ structured_output: { finding_reviews: [], new_findings: [], summary: 'no change' } }))
  const callLog = path.join(home, 'calls.txt')
  fs.writeFileSync(path.join(bin, 'claude'), CLAUDE_STUB, { mode: 0o755 })

  fs.mkdirSync(path.join(project, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(project, '.claude', 'engineering-baseline.json'), JSON.stringify(BASELINE, null, 2))
  fs.writeFileSync(path.join(project, '.claude', 'engineering-baseline.md'), '# Engineering Baseline\n')
  fs.writeFileSync(path.join(project, 'src.ts'), 'export const a = 1\n')
  execFileSync('git', ['init', '-q'], { cwd: project, stdio: 'ignore' })
  execFileSync('git', ['add', '-A'], { cwd: project, stdio: 'ignore' })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: project, stdio: 'ignore' })

  const slug = path.basename(fs.realpathSync(project)).replace(/[^A-Za-z0-9._-]+/g, '_')
  const hash = execFileSync('bash', ['-c', `printf '%s' "$(cd ${JSON.stringify(project)} && pwd -P)" | shasum -a 256 | awk '{print substr($1,1,12)}'`], { encoding: 'utf8' }).trim()
  const stateDir = path.join(home, '.claude', 'harness-runtime', `${slug}_${hash}`)
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(path.join(stateDir, 'baseline-refresh-on-stop'), '')

  const run = () => spawnSync('bash', [REFRESH, '--project', project], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_CALL_LOG: callLog,
      STUB_RESPONSE: response,
    },
    encoding: 'utf8',
  })

  const calls = () => (fs.existsSync(callLog) ? fs.readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length : 0)

  return { home, project, stateDir, run, calls }
}

test('an edit made through Bash still reaches the baseline refresh', { skip }, (t) => {
  const world = makeWorld(t)

  // Exactly the state a Bash-only session leaves behind: the file changed, and the PostToolUse
  // edit record — which never fired — does not exist.
  fs.writeFileSync(path.join(world.project, 'src.ts'), 'export const a = 2\n')
  assert.equal(fs.existsSync(path.join(world.stateDir, 'baseline-dirty')), false)
  assert.equal(fs.existsSync(path.join(world.stateDir, 'changed-files.txt')), false)

  const result = world.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(world.calls(), 1, 'the refresh exited without ever consulting the model')
})

test('a session that changed nothing still costs no model call', { skip }, (t) => {
  const world = makeWorld(t)

  const result = world.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(world.calls(), 0, 'a clean tree with no edit record must take the fast path')
})

test('the same unchanged dirty tree is not analysed twice', { skip }, (t) => {
  const world = makeWorld(t)

  // A working tree can stay dirty across many turns. Reading git as a second source must not
  // turn every later Stop — including one that only answered a question — into a paid call.
  fs.writeFileSync(path.join(world.project, 'src.ts'), 'export const a = 2\n')
  assert.equal(world.run().status, 0)
  assert.equal(world.calls(), 1)

  assert.equal(world.run().status, 0)
  assert.equal(world.calls(), 1, 'an unchanged dirty tree bought a second model call')

  // A further edit is a different changed set, so it is analysed.
  fs.writeFileSync(path.join(world.project, 'other.ts'), 'export const b = 1\n')
  assert.equal(world.run().status, 0)
  assert.equal(world.calls(), 2, 'a new edit on an already-dirty tree was skipped')
})

test('a changed set of only harness bookkeeping still costs no model call', { skip }, (t) => {
  const world = makeWorld(t)

  // The generated files the refresh itself writes must never trigger the next refresh, or the
  // gate feeds itself forever.
  fs.writeFileSync(path.join(world.project, '.claude', 'engineering-baseline.md'), '# Engineering Baseline\n\nedited\n')

  const result = world.run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(world.calls(), 0)
})
