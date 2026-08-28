// init-project.sh synthesizes .claude/verify.sh per stack and then splices the Dockerfile
// lint block in by rewriting the file. Two shipped regressions lived in exactly that code
// (the block never inserted on macOS, and a Bash 3.2 unbound-array abort), and CI only
// shellchecks the source scripts. These cases run the generator and inspect its output.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const INIT = path.join(ROOT, 'tools', 'init-project.sh')

function have(command) {
  try {
    execFileSync('bash', ['-c', `command -v ${command}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const HAVE_GIT = have('git')
const HAVE_SHELLCHECK = have('shellcheck')

// The initializer resolves the project root through git, so each fixture is its own
// repository. Without that, a tmpdir that happened to sit inside a checkout would send the
// generator at the surrounding repository instead.
function fixture(t, files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-init-home-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-init-project-'))
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(project, { recursive: true, force: true })
  })

  const harness = path.join(home, '.claude', 'harness')
  fs.mkdirSync(path.join(harness, 'project-template', '.claude'), { recursive: true })
  fs.writeFileSync(path.join(harness, 'engineering.md'), '# standard\n')
  fs.copyFileSync(
    path.join(ROOT, 'project-template', '.claude', 'preflight.sh'),
    path.join(harness, 'project-template', '.claude', 'preflight.sh')
  )

  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(project, path.dirname(name)), { recursive: true })
    fs.writeFileSync(path.join(project, name), body)
  }
  execFileSync('git', ['init', '-q'], { cwd: project, stdio: 'ignore' })

  execFileSync('bash', [INIT, '--skip-graft', '--skip-ai-analysis', '--skip-verify', '--project', project], {
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: '' },
    encoding: 'utf8',
    stdio: 'pipe'
  })

  const verify = path.join(project, '.claude', 'verify.sh')
  return { project, verify, body: fs.readFileSync(verify, 'utf8') }
}

function assertUsableScript(verify, body) {
  execFileSync('bash', ['-n', verify], { stdio: 'pipe' })
  assert.ok(fs.statSync(verify).mode & 0o111, 'the generated verify.sh is not executable')
  assert.match(body, /HARNESS_PREFLIGHT_DONE/, 'the generated verify.sh never runs the preflight')
  assert.match(body, /hadolint/, 'the Dockerfile lint block was not spliced in')
  assert.ok(
    body.indexOf('HARNESS_PREFLIGHT_DONE') < body.indexOf('hadolint'),
    'the Dockerfile lint block was inserted before the preflight line'
  )
  if (HAVE_SHELLCHECK) {
    execFileSync('shellcheck', ['-s', 'bash', verify], { stdio: 'pipe' })
  }
}

const skip = !HAVE_GIT && 'git is unavailable'

test('the verify.sh generated for a Node project is a usable script', { skip }, t => {
  const { verify, body } = fixture(t, {
    'package.json': JSON.stringify({
      name: 'fixture-app',
      scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run', build: 'tsc' }
    }),
    'Dockerfile': 'FROM node:22-slim\n'
  })
  assertUsableScript(verify, body)
  for (const script of ['lint', 'typecheck', 'test', 'build']) {
    assert.match(body, new RegExp(`npm run ${script}`), `the ${script} script is missing from verification`)
  }
})

test('a Node project without usable scripts fails loudly instead of verifying nothing', { skip }, t => {
  const { verify, body } = fixture(t, {
    'package.json': JSON.stringify({ name: 'fixture-empty', scripts: { start: 'node index.js' } })
  })
  assertUsableScript(verify, body)
  assert.match(body, /exit 3/, 'a project with no verification strategy does not exit 3')
})

test('a repository with no recognized manifest still generates a usable script', { skip }, t => {
  const { verify, body } = fixture(t, { 'README.md': '# bare\n' })
  assertUsableScript(verify, body)
  assert.match(body, /No verification strategy could be detected/)
  assert.match(body, /exit 3/, 'the generic fallback does not exit 3')
})

test('a Python project generates a usable script', { skip }, t => {
  const { verify, body } = fixture(t, { 'pyproject.toml': '[project]\nname = "fixture"\n' })
  assertUsableScript(verify, body)
  assert.match(body, /pytest/)
})

test('initialization leaves the Stop gate off until verification has actually passed', { skip }, t => {
  const { project } = fixture(t, { 'package.json': JSON.stringify({ name: 'fixture', scripts: { test: 'true' } }) })
  assert.ok(!fs.existsSync(path.join(project, '.claude', 'verify-on-stop')),
    'a --skip-verify run enabled the Stop gate')
  assert.ok(!fs.existsSync(path.join(project, '.claude', 'baseline-refresh-on-stop')),
    'a --skip-verify run enabled the living baseline')
})

// The preflight starts local infrastructure and used to leave it running with no mention of
// it — a change to the machine the caller never asked for. A real project whose stated policy
// is "Supabase stays down by default" found it up after an initialization, and its own
// analysis reported the harness for it.
//
// The split is deliberate: a one-shot `init-project.sh` restores what it started, while the
// Stop gate leaves the stack up, because restarting it before every task would cost far more
// than the gate is worth. So the preflight records what it started, and says so out loud when
// nobody is listening for the record.
//
// docker and supabase are stubbed: what is under test is what the preflight does about the
// stack, not the stack.
const PREFLIGHT = path.join(ROOT, 'project-template', '.claude', 'preflight.sh')

function preflightRun(t, { running }) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-preflight-'))
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-preflight-bin-'))
  t.after(() => {
    fs.rmSync(project, { recursive: true, force: true })
    fs.rmSync(bin, { recursive: true, force: true })
  })

  fs.mkdirSync(path.join(project, 'supabase'), { recursive: true })
  fs.writeFileSync(path.join(project, 'supabase', 'config.toml'), '[db]\n')
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  // `status` decides "already running"; `start` must never be reached when it is.
  // `start` flips the stub to running, the way the real CLI does: `wait_for_supabase` polls
  // `status` until it succeeds, and a stub frozen on "down" would spin for three minutes.
  const upFlag = path.join(project, 'stub-up')
  if (running) fs.writeFileSync(upFlag, '')
  fs.writeFileSync(
    path.join(bin, 'supabase'),
    [
      '#!/bin/sh',
      `UP=${JSON.stringify(upFlag)}`,
      'case "$1" in',
      '  status) [ -f "$UP" ] && exit 0 || exit 1 ;;',
      '  start) : > "$UP"; echo started ;;',
      '  stop) rm -f "$UP" ;;',
      'esac',
      'exit 0',
      ''
    ].join('\n'),
    { mode: 0o755 }
  )

  const record = path.join(project, 'started.txt')
  const run = env => spawnSync('bash', [PREFLIGHT], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env }
  })
  return { project, record, run }
}

test('the stack this preflight started is recorded for a caller that asks', { skip }, t => {
  const box = preflightRun(t, { running: false })
  const result = box.run({ HARNESS_INFRA_STARTED_FILE: box.record })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(box.record, 'utf8'), 'supabase\n')
})

test('a stack that was already up is not recorded, so it is never stopped', { skip }, t => {
  const box = preflightRun(t, { running: true })
  const result = box.run({ HARNESS_INFRA_STARTED_FILE: box.record })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.existsSync(box.record), false, 'a stack the user started would be stopped out from under them')
})

test('with nobody keeping the record, the preflight says it left the stack running', { skip }, t => {
  const box = preflightRun(t, { running: false })
  const result = box.run({})
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /is left running/, 'starting infrastructure silently is the original defect')
  assert.match(result.stdout, /Stop it with:/, 'the message must carry the command that undoes it')
})

test('the one-shot initializer asks for the record and stops what it started', { skip }, t => {
  const body = fs.readFileSync(INIT, 'utf8')
  assert.match(body, /HARNESS_INFRA_STARTED_FILE="\$INFRA_STARTED_FILE" "\$PREFLIGHT_FILE"/)
  assert.match(body, /Stopping the Supabase stack this run started/)
  // Never fatal: verification has already been decided by the time this runs.
  assert.match(body, /Could not stop Supabase; stop it by hand/)
})
