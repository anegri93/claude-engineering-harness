// Behavioural tests for the two shipped hooks, which are the only mechanical guarantee the
// harness makes. Both are run as real subprocesses against a throwaway HOME and a throwaway
// git repository, because every risk being covered here is about what they do on disk and
// which exit code Claude Code receives.
//
// Two shipped files carry the comment "tests/hooks.test.mjs asserts the two agree" about a
// deliberately duplicated ignore list. This is that assertion.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const MARK_HOOK = path.join(ROOT, 'src', 'hooks', 'mark-baseline-dirty.sh')
const VERIFY_HOOK = path.join(ROOT, 'src', 'hooks', 'verify-project.sh')

// --- the duplicated ignore list -------------------------------------------------------

// Rather than restating either pattern in JavaScript — which would just add a third copy to
// keep in sync — both are extracted from source and evaluated by the tool that actually
// applies them, then compared decision by decision.
function caseGlobs() {
  const body = fs.readFileSync(MARK_HOOK, 'utf8')
  const match = /\n\s*(\.claude\/engineering-baseline\.md\|[^)]+)\)\n/.exec(body)
  assert.ok(match, 'could not find the case ignore list in mark-baseline-dirty.sh')
  return match[1]
}

function grepRegex() {
  const body = fs.readFileSync(path.join(ROOT, 'tools', 'refresh-baseline.sh'), 'utf8')
  const match = /grep -Ev '(\^\([^']+)'/.exec(body)
  assert.ok(match, 'could not find the grep ignore regex in refresh-baseline.sh')
  return match[1]
}

function ignoredByCase(globs, candidate) {
  const script = `case "$1" in\n  ${globs})\n    exit 10\n    ;;\nesac\nexit 0\n`
  const result = spawnSync('bash', ['-c', script, 'hook', candidate], { encoding: 'utf8' })
  assert.equal(result.status === 0 || result.status === 10, true, result.stderr)
  return result.status === 10
}

function ignoredByRegex(regex, candidate) {
  // grep -Ev keeps the lines the refresh treats as relevant, so no output means ignored.
  const result = spawnSync('grep', ['-Ev', regex], { input: `${candidate}\n`, encoding: 'utf8' })
  return result.stdout.trim() === ''
}

const IGNORE_CORPUS = [
  '.claude/engineering-baseline.md',
  '.claude/engineering-baseline.json',
  '.claude/rules/harness-shell.md',
  '.claude/verify.sh',
  '.claude/verify-on-stop',
  '.claude/baseline-refresh-on-stop',
  'graft/INDEX.md',
  'node_modules/left-pad/index.js',
  'dist/bundle.js',
  'build/output.css',
  'coverage/lcov.info',
  'src/index.ts',
  'src/hooks/verify-project.sh',
  'README.md',
  '.claude/settings.json',
  '.claude/preflight.sh',
  'graftless/file.ts',
  'tests/hooks.test.mjs',
  'package.json',
]

test('the PostToolUse case list and the refresh grep filter make the same call on every path', () => {
  const globs = caseGlobs()
  const regex = grepRegex()

  for (const candidate of IGNORE_CORPUS) {
    assert.equal(
      ignoredByCase(globs, candidate),
      ignoredByRegex(regex, candidate),
      `the two ignore lists disagree about ${candidate}`,
    )
  }
})

test('the ignore list actually ignores harness bookkeeping and keeps real source', () => {
  const globs = caseGlobs()
  assert.equal(ignoredByCase(globs, '.claude/engineering-baseline.json'), true)
  assert.equal(ignoredByCase(globs, 'graft/INDEX.md'), true)
  assert.equal(ignoredByCase(globs, 'src/index.ts'), false)
  // A directory whose name merely starts with an ignored one must not be swept up.
  assert.equal(ignoredByCase(globs, 'graftless/file.ts'), false)
})

// --- sandbox --------------------------------------------------------------------------

function sandbox(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-hooks-home-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-hooks-project-'))
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(project, { recursive: true, force: true })
  })
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.mkdirSync(path.join(project, '.claude'), { recursive: true })
  fs.mkdirSync(path.join(project, 'src'), { recursive: true })

  const git = args => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' })
  git(['init', '--quiet'])
  git(['config', 'user.email', 'test@example.invalid'])
  git(['config', 'user.name', 'Harness Test'])
  fs.writeFileSync(path.join(project, 'README.md'), 'seed\n')
  git(['add', '-A'])
  git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'seed'])

  return { home, project, git }
}

function runHook(hook, { home, project }, payload) {
  return spawnSync('bash', [hook], {
    cwd: project,
    input: JSON.stringify(payload ?? {}),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project },
  })
}

// The hook derives its state directory from HOME and the project path, so the test asks the
// hook itself rather than reimplementing the slug and hash.
function stateDir(home) {
  const runtime = path.join(home, '.claude', 'harness-runtime')
  if (!fs.existsSync(runtime)) return null
  const entries = fs.readdirSync(runtime)
  return entries.length === 1 ? path.join(runtime, entries[0]) : null
}

function enableVerify(project, script) {
  fs.writeFileSync(path.join(project, '.claude', 'verify-on-stop'), '')
  fs.writeFileSync(path.join(project, '.claude', 'verify.sh'), script)
}

// --- mark-baseline-dirty.sh -------------------------------------------------------------

test('an edit to real source is recorded', t => {
  const box = sandbox(t)
  fs.writeFileSync(path.join(box.project, '.claude', 'verify-on-stop'), '')

  const result = runHook(MARK_HOOK, box, {
    tool_input: { file_path: path.join(box.project, 'src/index.ts') },
  })

  assert.equal(result.status, 0, result.stderr)
  const dir = stateDir(box.home)
  assert.ok(dir, 'no runtime state directory was created')
  assert.equal(fs.existsSync(path.join(dir, 'baseline-dirty')), true)
  assert.equal(fs.readFileSync(path.join(dir, 'changed-files.txt'), 'utf8'), 'src/index.ts\n')
})

test('an edit to a harness-generated file is not recorded', t => {
  const box = sandbox(t)
  fs.writeFileSync(path.join(box.project, '.claude', 'verify-on-stop'), '')

  const result = runHook(MARK_HOOK, box, {
    tool_input: { file_path: path.join(box.project, '.claude/engineering-baseline.md') },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(stateDir(box.home), null, 'harness bookkeeping was recorded as an engineering change')
})

test('nothing is recorded when neither gate is enabled', t => {
  const box = sandbox(t)

  const result = runHook(MARK_HOOK, box, {
    tool_input: { file_path: path.join(box.project, 'src/index.ts') },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(stateDir(box.home), null, 'state was written for a project that opted into nothing')
})

test('the record is written for Stop verification alone, with no baseline in the project', t => {
  const box = sandbox(t)
  // The record has two consumers. Tying it to the baseline would leave the verification gate
  // blind in every project that enabled verification without the living baseline.
  fs.writeFileSync(path.join(box.project, '.claude', 'verify-on-stop'), '')
  assert.equal(fs.existsSync(path.join(box.project, '.claude', 'engineering-baseline.json')), false)

  const result = runHook(MARK_HOOK, box, {
    tool_input: { file_path: path.join(box.project, 'src/index.ts') },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.ok(stateDir(box.home), 'the verification gate would never learn this task edited anything')
})

test('an edit outside the project is discarded', t => {
  const box = sandbox(t)
  fs.writeFileSync(path.join(box.project, '.claude', 'verify-on-stop'), '')

  const result = runHook(MARK_HOOK, box, {
    tool_input: { file_path: path.join(os.tmpdir(), 'somewhere-else.ts') },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(stateDir(box.home), null)
})

// --- verify-project.sh ------------------------------------------------------------------

test('a failing verification blocks the Stop', t => {
  const box = sandbox(t)
  enableVerify(box.project, 'echo "boom" >&2\nexit 1\n')
  fs.writeFileSync(path.join(box.project, 'src/index.ts'), 'export const x = 1\n')

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(result.status, 2, 'a real failure must block')
  assert.match(result.stderr, /Fix the verification errors/)
  assert.match(result.stderr, /boom/)
})

test('a passing verification does not block', t => {
  const box = sandbox(t)
  enableVerify(box.project, 'exit 0\n')
  fs.writeFileSync(path.join(box.project, 'src/index.ts'), 'export const x = 1\n')

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(result.status, 0, result.stderr)
})

test('"no verification strategy applies" is reported, not blocked', t => {
  const box = sandbox(t)
  // Exit 3 is what the generated .claude/verify.sh emits when it finds nothing to run.
  enableVerify(box.project, 'echo "nothing to run" >&2\nexit 3\n')
  fs.writeFileSync(path.join(box.project, 'src/index.ts'), 'export const x = 1\n')

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(result.status, 0, 'an unverifiable project must not be told its code is broken')
  assert.match(result.stderr, /could not run/)
  assert.match(result.stderr, /environment condition, not a defect/)
})

test('a missing command is reported with the remediation, not blocked', t => {
  const box = sandbox(t)
  enableVerify(box.project, 'exit 127\n')
  fs.writeFileSync(path.join(box.project, 'src/index.ts'), 'export const x = 1\n')

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(result.status, 0, 'a missing binary is not a defect in the change under review')
  assert.match(result.stderr, /Install the missing command/)
})

test('an enabled gate with nothing configured reports instead of blocking forever', t => {
  const box = sandbox(t)
  fs.writeFileSync(path.join(box.project, '.claude', 'verify-on-stop'), '')
  fs.writeFileSync(path.join(box.project, 'src/index.ts'), 'export const x = 1\n')

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(result.status, 0, 'no edit to this repository could ever clear such a block')
  assert.match(result.stderr, /could not run/)
})

test('a session that changed nothing skips verification entirely', t => {
  const box = sandbox(t)
  // A tree left dirty by generated output would defeat this, which is why init-project.sh
  // teaches git to ignore graft/.
  enableVerify(box.project, 'echo "verify.sh should not have run" >&2\nexit 1\n')
  box.git(['add', '-A'])
  box.git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'enable gate'])

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /should not have run/)
})

test('a task that committed its own edits is still verified', t => {
  const box = sandbox(t)
  enableVerify(box.project, 'exit 1\n')
  box.git(['add', '-A'])
  box.git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'enable gate'])

  // The task edits a file and commits it, so git reports a clean tree at Stop.
  runHook(MARK_HOOK, box, { tool_input: { file_path: path.join(box.project, 'src/index.ts') } })
  fs.writeFileSync(path.join(box.project, 'src/index.ts'), 'export const x = 1\n')
  box.git(['add', '-A'])
  box.git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'the task'])
  assert.equal(box.git(['status', '--porcelain']).trim(), '', 'the tree must be clean for this test to mean anything')

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(result.status, 2, 'the gate skipped exactly when the change became permanent')
})

test('a Stop that is already reacting to a Stop hook does not recurse', t => {
  const box = sandbox(t)
  enableVerify(box.project, 'echo "verify.sh should not have run" >&2\nexit 1\n')
  fs.writeFileSync(path.join(box.project, 'src/index.ts'), 'export const x = 1\n')

  const result = runHook(VERIFY_HOOK, box, { stop_hook_active: true })

  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /should not have run/)
})

test('the hook is inert in a project that enabled neither gate', t => {
  const box = sandbox(t)
  fs.writeFileSync(path.join(box.project, '.claude', 'verify.sh'), 'exit 1\n')
  fs.writeFileSync(path.join(box.project, 'src/index.ts'), 'export const x = 1\n')

  const result = runHook(VERIFY_HOOK, box, {})

  assert.equal(result.status, 0, result.stderr)
})
