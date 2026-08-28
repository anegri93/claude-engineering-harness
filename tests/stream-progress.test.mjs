// stream-progress.mjs stands between the streamed Claude analysis and the renderers: what it
// writes to --result-out is what the baseline is generated from. The risks covered here are a
// truncated stream being treated as a finished analysis, model-authored text reaching a terminal
// with escape sequences intact, and the result event being reshaped on the way through.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'stream-progress.mjs')

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stream-progress-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function run(dir, events, extraArgs = []) {
  const resultOut = path.join(dir, 'result.json')
  const rawOut = path.join(dir, 'raw.ndjson')
  const input = events.map(event => (typeof event === 'string' ? event : JSON.stringify(event))).join('\n') + '\n'
  const proc = spawnSync(process.execPath, [
    TOOL,
    '--result-out', resultOut,
    '--raw-out', rawOut,
    '--label', 'repository analysis',
    ...extraArgs
  ], { input, encoding: 'utf8' })
  return {
    status: proc.status,
    stdout: proc.stdout,
    stderr: proc.stderr,
    resultOut,
    rawOut,
    result: () => JSON.parse(fs.readFileSync(resultOut, 'utf8')),
    raw: () => fs.readFileSync(rawOut, 'utf8')
  }
}

const RESULT_EVENT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 2,
  structured_output: { summary: 'A fixture system.' }
}

test('writes the result event unchanged, in the shape --output-format json produces', t => {
  const dir = workspace(t)
  const run1 = run(dir, [
    { type: 'system', subtype: 'init', cwd: dir },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Glob', input: { pattern: 'src/**' } }] } },
    { type: 'user', message: { role: 'user', content: [] } },
    RESULT_EVENT
  ])

  assert.equal(run1.status, 0)
  assert.deepEqual(run1.result(), RESULT_EVENT)
  // The renderers read structured_output off this object; nothing may be rewrapped.
  assert.deepEqual(run1.result().structured_output, RESULT_EVENT.structured_output)
})

test('progress is reported on stderr only, leaving stdout for the caller', t => {
  const dir = workspace(t)
  const run1 = run(dir, [
    { type: 'system', subtype: 'init', cwd: dir },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(dir, 'src/app.ts') } }] } },
    RESULT_EVENT
  ])

  assert.equal(run1.stdout, '')
  assert.match(run1.stderr, /repository analysis finished in \d\d:\d\d/)
  assert.match(run1.stderr, /1 tool calls?/)
})

test('a stream that ends without a result event fails instead of rendering a partial analysis', t => {
  const dir = workspace(t)
  const run1 = run(dir, [
    { type: 'system', subtype: 'init', cwd: dir },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } }
  ])

  assert.equal(run1.status, 1)
  assert.match(run1.stderr, /without a result event/)
  assert.equal(fs.existsSync(run1.resultOut), false)
})

test('model-authored tool detail cannot carry escape sequences to the terminal', t => {
  const dir = workspace(t)
  const hostile = '\u001b[2Jsrc/\u0007owned.ts\r'
  const run1 = run(dir, [
    { type: 'system', subtype: 'init', cwd: dir },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Read\u001b[31m', input: { file_path: hostile } }] } },
    RESULT_EVENT
  ])

  assert.equal(run1.status, 0)
  // Progress prints only on a change plus a five-second floor, so the hostile path may never be
  // printed at all. What must hold is that no control character from it reaches stderr.
  assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(run1.stderr), false)
  // The raw mirror is a diagnostic file, not terminal output, and keeps the stream verbatim.
  assert.ok(run1.raw().includes('owned.ts'))
})

test('unparsable stream lines are counted and reported rather than silently dropped', t => {
  const dir = workspace(t)
  const run1 = run(dir, [
    { type: 'system', subtype: 'init', cwd: dir },
    'this is not json',
    '{"type":"assistant","message":',
    RESULT_EVENT
  ])

  assert.equal(run1.status, 0)
  assert.match(run1.stderr, /2 unparsed stream lines/)
})

test('turns are counted per assistant message, not per event', t => {
  const dir = workspace(t)
  const run1 = run(dir, [
    { type: 'system', subtype: 'init', cwd: dir },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'thinking', thinking: 'x' }] } },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } },
    { type: 'assistant', message: { id: 'msg_2', content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'b.ts' } }] } },
    RESULT_EVENT
  ], ['--turn-budget', '40'])

  assert.equal(run1.status, 0)
  assert.match(run1.stderr, /2 turns/)
})

test('the raw stream is mirrored for failure diagnostics', t => {
  const dir = workspace(t)
  const run1 = run(dir, [{ type: 'system', subtype: 'init', cwd: dir }, RESULT_EVENT])

  assert.equal(run1.raw().trim().split('\n').length, 2)
})

test('--result-out is required', t => {
  const dir = workspace(t)
  const proc = spawnSync(process.execPath, [TOOL], { input: '', encoding: 'utf8', cwd: dir })

  assert.equal(proc.status, 2)
  assert.match(proc.stderr, /--result-out/)
})

// End-to-end wiring. `bash -n` cannot see either of the two failure modes this covers: the
// pipeline's exit status being read from the wrong place (Bash 3.2 resets PIPESTATUS after a
// plain assignment, which made the second read an unbound-variable abort under `set -u`), and
// the CLI rejecting the flag combination the streamed call now uses. Both only appear when the
// script actually runs, so this drives init-project.sh against a stub `claude`.
const INIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'init-project.sh')
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function haveGit() {
  const proc = spawnSync('bash', ['-c', 'command -v git'], { stdio: 'ignore' })
  return proc.status === 0
}

const STUB_ANALYSIS = {
  summary: 'A fixture system.',
  architecture_summary: 'One layer that does one thing.',
  key_modules: [],
  always_on_rules: [],
  business_invariants: [],
  rule_groups: [],
  risks: [],
  confidence_notes: 'Fixture.'
}

// Emits the same event sequence the CLI streams, and fails loudly if the harness ever stops
// passing the flags that make that stream possible.
function stubClaude(binDir, events) {
  fs.mkdirSync(binDir, { recursive: true })
  const stub = path.join(binDir, 'claude')
  fs.writeFileSync(stub, [
    '#!/usr/bin/env bash',
    'set -u',
    'if [[ "${1:-}" == "auth" ]]; then exit 0; fi',
    'for arg in "$@"; do',
    '  case "$arg" in',
    '    stream-json) SAW_STREAM=1 ;;',
    '    --verbose) SAW_VERBOSE=1 ;;',
    '  esac',
    'done',
    'if [[ -z "${SAW_STREAM:-}" || -z "${SAW_VERBOSE:-}" ]]; then',
    '  echo "stub claude: --verbose --output-format stream-json expected" >&2',
    '  exit 64',
    'fi',
    `cat <<'STUB_STREAM_EOF'`,
    events.map(event => JSON.stringify(event)).join('\n'),
    'STUB_STREAM_EOF'
  ].join('\n') + '\n')
  fs.chmodSync(stub, 0o755)
  return binDir
}

test('a streamed analysis run completes and reports its progress', { skip: !haveGit() && 'git is unavailable' }, t => {
  const dir = workspace(t)
  const home = path.join(dir, 'home')
  const project = path.join(dir, 'project')
  const harness = path.join(home, '.claude', 'harness')
  const tools = path.join(home, '.claude', 'harness-tools')

  fs.mkdirSync(path.join(harness, 'project-template', '.claude'), { recursive: true })
  fs.mkdirSync(tools, { recursive: true })
  for (const name of fs.readdirSync(path.join(ROOT, 'src', 'harness'))) {
    fs.copyFileSync(path.join(ROOT, 'src', 'harness', name), path.join(harness, name))
  }
  fs.copyFileSync(
    path.join(ROOT, 'project-template', '.claude', 'preflight.sh'),
    path.join(harness, 'project-template', '.claude', 'preflight.sh')
  )
  for (const name of fs.readdirSync(path.join(ROOT, 'tools'))) {
    fs.copyFileSync(path.join(ROOT, 'tools', name), path.join(tools, name))
  }

  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'true' } }))
  spawnSync('git', ['init', '-q'], { cwd: project, stdio: 'ignore' })

  const binDir = stubClaude(path.join(dir, 'bin'), [
    { type: 'system', subtype: 'init', cwd: project, session_id: 's' },
    { type: 'system', subtype: 'thinking_tokens', estimated_tokens_delta: 120 },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Glob', input: { pattern: '**/*.json' } }] } },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 1, structured_output: STUB_ANALYSIS }
  ])

  const proc = spawnSync('bash', [INIT, '--skip-graft', '--skip-verify', '--project', project], {
    env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: '' },
    encoding: 'utf8'
  })

  const output = proc.stdout + proc.stderr
  assert.equal(proc.status, 0, `initialization failed:\n${output}`)
  assert.doesNotMatch(output, /unbound variable/)
  assert.match(output, /repository analysis finished in \d\d:\d\d/)
  assert.match(output, /Repository analysis completed/)
  assert.match(fs.readFileSync(path.join(project, '.claude', 'engineering-baseline.md'), 'utf8'), /fixture system/)
})

// The repainting branch is what a real terminal shows, and it is where model-authored text is one
// escape sequence away from driving the cursor. A spawned test process has no TTY on stderr, so
// the seam below selects that branch explicitly.
test('the repainting terminal line carries no escape sequence the model supplied', t => {
  const dir = workspace(t)
  const resultOut = path.join(dir, 'result.json')
  const hostile = '\u001b[2Jsrc/\u0007owned.ts'
  const input = [
    { type: 'system', subtype: 'init', cwd: dir },
    { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Read', input: { file_path: hostile } }] } },
    RESULT_EVENT
  ].map(event => JSON.stringify(event)).join('\n') + '\n'

  const proc = spawnSync(process.execPath, [TOOL, '--result-out', resultOut, '--label', 'analysis'], {
    input,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_PROGRESS_TTY: '1' }
  })

  assert.equal(proc.status, 0)
  assert.match(proc.stderr, /\r/, 'the terminal branch did not repaint a single line')
  assert.match(proc.stderr, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, 'the terminal branch printed no spinner')
  assert.ok(proc.stderr.includes('owned.ts'), 'the activity was never shown')
  // The tool emits its own CSI 2K to clear the line; no other escape sequence may reach the
  // terminal, and no control character from the model may survive at all.
  assert.equal(proc.stderr.includes('\u001b[2J'), false, 'a model-supplied escape sequence reached the terminal')
  assert.equal(proc.stderr.includes('\u0007'), false, 'a model-supplied control character reached the terminal')
  assert.equal(proc.stderr.split('\u001b[2K').join('').includes('\u001b'), false, 'an unexpected escape sequence reached the terminal')
})
