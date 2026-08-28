// The harness installs its hooks globally, so they fire in every repository the user opens —
// including one they just cloned. Two of its steps execute scripts the repository ships:
// the Stop gate runs .claude/verify.sh, and initialization runs .claude/preflight.sh. Both
// decisions used to be read out of the repository itself, so a clone could grant the harness
// permission to run the clone's own code, with no action from the user beyond asking Claude a
// question or running the documented adoption command.
//
// These tests assert the boundary: consent lives on the user's side of the line.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const VERIFY_HOOK = path.join(ROOT, 'src', 'hooks', 'verify-project.sh')
const MARK_HOOK = path.join(ROOT, 'src', 'hooks', 'mark-baseline-dirty.sh')
const INIT = path.join(ROOT, 'tools', 'init-project.sh')

function have(command) {
  try {
    execFileSync('bash', ['-c', `command -v ${command}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const skip = !have('git') && 'git is unavailable'

// The hooks derive their state directory from HOME and the physical project path. The test
// computes it the same way so it can assert on a path the repository cannot reach.
function stateDirFor(home, project) {
  const real = fs.realpathSync(project)
  const slug = path.basename(real).replace(/[^A-Za-z0-9._-]+/g, '_')
  const hash = crypto.createHash('sha256').update(real).digest('hex').slice(0, 12)
  return path.join(home, '.claude', 'harness-runtime', `${slug}_${hash}`)
}

// A repository as it arrives from `git clone`: it ships the enabling marker and a verify.sh
// that would prove it ran. Nothing here was written by the user.
function hostileClone(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-consent-home-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-consent-project-'))
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(project, { recursive: true, force: true })
  })
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true })

  const proof = path.join(project, 'IT-RAN')
  fs.writeFileSync(path.join(project, '.claude', 'verify-on-stop'), '')
  fs.writeFileSync(path.join(project, '.claude', 'baseline-refresh-on-stop'), '')
  fs.writeFileSync(path.join(project, '.claude', 'verify.sh'), `#!/usr/bin/env bash\ntouch ${JSON.stringify(proof)}\n`, { mode: 0o755 })

  execFileSync('git', ['-C', project, 'init', '-q'], { stdio: 'ignore' })
  return { home, project, proof }
}

function runHook(hook, { home, project }, payload) {
  return spawnSync('bash', [hook], {
    cwd: project,
    input: JSON.stringify(payload ?? {}),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project },
  })
}

// --- door 1: the Stop gate ---------------------------------------------------------------

test('a cloned repository cannot enable the Stop gate on itself', { skip }, t => {
  const box = hostileClone(t)

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(
    fs.existsSync(box.proof),
    false,
    'a repository shipped its own verify-on-stop and the harness executed its verify.sh',
  )
  assert.equal(result.status, 0)
})

test('the in-repo marker is reported rather than silently ignored', { skip }, t => {
  const box = hostileClone(t)

  const result = runHook(VERIFY_HOOK, box, {})

  // A project initialized before this change would otherwise go quiet with no explanation.
  assert.match(result.stderr, /NOT running in this project/)
  assert.match(result.stderr, /init-project\.sh/)
})

test('the gate runs when consent is recorded on the user side', { skip }, t => {
  const box = hostileClone(t)
  const state = stateDirFor(box.home, box.project)
  fs.mkdirSync(state, { recursive: true })
  fs.writeFileSync(path.join(state, 'verify-on-stop'), '')

  runHook(VERIFY_HOOK, box, {})

  assert.equal(fs.existsSync(box.proof), true, 'the gate did not run for a project the user enabled')
})

test('a cloned repository cannot switch on the edit recorder either', { skip }, t => {
  const box = hostileClone(t)
  fs.writeFileSync(path.join(box.project, '.claude', 'engineering-baseline.json'), '{}')

  runHook(MARK_HOOK, box, { tool_input: { file_path: path.join(box.project, 'src/index.ts') } })

  const state = stateDirFor(box.home, box.project)
  assert.equal(fs.existsSync(state), false, 'the repository turned on harness bookkeeping by shipping a marker')
})

// --- door 2: initialization runs the repository's preflight -------------------------------

function initFixture(t, { preflight, args = [] }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pf-home-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pf-project-'))
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(project, { recursive: true, force: true })
  })

  const harness = path.join(home, '.claude', 'harness')
  fs.mkdirSync(path.join(harness, 'project-template', '.claude'), { recursive: true })
  fs.writeFileSync(path.join(harness, 'engineering.md'), '# standard\n')
  fs.copyFileSync(
    path.join(ROOT, 'project-template', '.claude', 'preflight.sh'),
    path.join(harness, 'project-template', '.claude', 'preflight.sh'),
  )

  const proof = path.join(project, 'PREFLIGHT-RAN')
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true })
  if (preflight) {
    fs.writeFileSync(path.join(project, '.claude', 'preflight.sh'), preflight(proof), { mode: 0o755 })
  }
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: {} }))
  execFileSync('git', ['-C', project, 'init', '-q'], { stdio: 'ignore' })

  const run = extra => spawnSync('bash', [INIT, '--skip-graft', '--skip-ai-analysis', '--project', project, ...args, ...extra], {
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: '' },
    encoding: 'utf8',
  })

  return { home, project, proof, run, preflightPath: path.join(project, '.claude', 'preflight.sh') }
}

// A preflight the repository shipped: no harness marker, and it proves it ran.
const HOSTILE_PREFLIGHT = proof => `#!/usr/bin/env bash\ntouch ${JSON.stringify(proof)}\n`

test('initialization does not execute a preflight the repository shipped', { skip }, t => {
  const box = initFixture(t, { preflight: HOSTILE_PREFLIGHT })

  const result = box.run([])

  assert.equal(
    fs.existsSync(box.proof),
    false,
    'running the documented adoption command executed a script that arrived in the clone',
  )
  assert.match(result.stderr, /did NOT enable it/)
  assert.match(result.stderr, /--trust-preflight/)
})

test('an unapproved preflight keeps its contents and loses only its executable bit', { skip }, t => {
  const box = initFixture(t, { preflight: HOSTILE_PREFLIGHT })
  const before = fs.readFileSync(box.preflightPath, 'utf8')

  box.run([])

  assert.equal(fs.readFileSync(box.preflightPath, 'utf8'), before, 'the user file was modified')
  assert.equal(Boolean(fs.statSync(box.preflightPath).mode & 0o111), false, 'it is still executable, so it still runs')
})

test('the generated verify.sh cannot run an unapproved preflight either', { skip }, t => {
  const box = initFixture(t, { preflight: HOSTILE_PREFLIGHT })
  box.run([])

  // The generated script guards on -x, which is what withholding the bit disables. Running it
  // directly is the check that matters: this is what fires before every Stop.
  const verify = path.join(box.project, '.claude', 'verify.sh')
  spawnSync('bash', [verify], { cwd: box.project, encoding: 'utf8' })

  assert.equal(fs.existsSync(box.proof), false, 'the Stop path still executes the unapproved preflight')
})

test('--trust-preflight approves it, and the approval is remembered', { skip }, t => {
  const box = initFixture(t, { preflight: HOSTILE_PREFLIGHT })

  box.run(['--trust-preflight'])
  assert.equal(fs.existsSync(box.proof), true, 'an explicitly approved preflight was still not run')

  // A later run without the flag must not demand approval again for the same file.
  fs.rmSync(box.proof)
  const second = box.run([])
  assert.equal(fs.existsSync(box.proof), true, 'the approval was not remembered')
  assert.doesNotMatch(second.stderr, /did NOT enable it/)
})

test('editing an approved preflight withdraws the approval', { skip }, t => {
  const box = initFixture(t, { preflight: HOSTILE_PREFLIGHT })
  box.run(['--trust-preflight'])

  // What a `git pull` could bring into a repository the user already adopted.
  fs.writeFileSync(box.preflightPath, `#!/usr/bin/env bash\ntouch ${JSON.stringify(box.proof)}\n# changed\n`, { mode: 0o755 })
  fs.rmSync(box.proof, { force: true })

  const result = box.run([])

  assert.equal(fs.existsSync(box.proof), false, 'a preflight that changed after approval ran unchallenged')
  assert.match(result.stderr, /did NOT enable it/)
})

test('a harness-generated preflight needs no approval', { skip }, t => {
  const box = initFixture(t, { preflight: null })

  const result = box.run([])

  assert.equal(Boolean(fs.statSync(box.preflightPath).mode & 0o111), true, 'the harness withheld trust from its own file')
  assert.doesNotMatch(result.stderr, /did NOT enable it/)
})

// --- the boundary itself ------------------------------------------------------------------

test('no shipped hook reads its enabling marker from the repository', () => {
  for (const hook of [VERIFY_HOOK, MARK_HOOK]) {
    const body = fs.readFileSync(hook, 'utf8')
    for (const line of body.split('\n')) {
      // The legacy notice in verify-project.sh names the in-repo path to report it, never to
      // act on it, so only assignments to the enabling flags are checked.
      if (/(VERIFY_ENABLED|BASELINE_ENABLED|TRACK)=true/.test(line)) {
        assert.match(
          line,
          /\$STATE_DIR/,
          `${path.basename(hook)} enables itself from a path the repository controls: ${line.trim()}`,
        )
      }
    }
  }
})
