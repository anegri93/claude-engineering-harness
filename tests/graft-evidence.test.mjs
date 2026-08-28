// "Absence is not data." Wiring Graft in and getting usable answers out of it are different
// things, and the initializer used to report the first as `GRAFT_STATUS="passed"` — set on
// `graft init` alone — then write that word into the analysis prompt and the run summary. A
// repository whose graph answered nothing produced a prompt identical to one where every
// query landed, so a groundless analysis read exactly like a grounded one.
//
// Graft is stubbed. What is under test is what the harness reports about the evidence it got,
// not Graft itself.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

const skip = !have('git') && 'git is unavailable'

// answers: whether `graft map` and `graft ask` return anything.
// lsp:     whether `graft build --lsp` succeeds.
const GRAFT_STUB = `#!/bin/sh
case "$1" in
  --version|version) echo "graft 9.9.9" ;;
  init) exit 0 ;;
  build) [ "\${STUB_LSP:-0}" = "1" ] && exit 0 || exit 1 ;;
  map) [ "\${STUB_ANSWERS:-0}" = "1" ] && echo "## repo map" || true ;;
  ask) [ "\${STUB_ANSWERS:-0}" = "1" ] && echo "src/thing.ts:12 does the thing" || true ;;
  *) exit 0 ;;
esac
exit 0
`

function runInit(t, { answers, lsp }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-graft-home-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-graft-project-'))
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-graft-bin-'))
  t.after(() => {
    for (const dir of [home, project, bin]) fs.rmSync(dir, { recursive: true, force: true })
  })

  const harness = path.join(home, '.claude', 'harness')
  fs.mkdirSync(path.join(harness, 'project-template', '.claude'), { recursive: true })
  fs.writeFileSync(path.join(harness, 'engineering.md'), '# standard\n')
  fs.copyFileSync(
    path.join(ROOT, 'project-template', '.claude', 'preflight.sh'),
    path.join(harness, 'project-template', '.claude', 'preflight.sh'),
  )

  fs.writeFileSync(path.join(bin, 'graft'), GRAFT_STUB, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\ncase "$1" in view) echo 9.9.9;; *) exit 0;; esac\n', { mode: 0o755 })

  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'true' } }))
  execFileSync('git', ['init', '-q'], { cwd: project, stdio: 'ignore' })

  return execFileSync('bash', [INIT, '--skip-ai-analysis', '--skip-verify', '--project', project], {
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_PROJECT_DIR: '',
      PATH: `${bin}:${process.env.PATH}`,
      STUB_ANSWERS: answers ? '1' : '0',
      STUB_LSP: lsp ? '1' : '0',
    },
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

test('a graph that answers nothing is not reported as a successful integration', { skip }, t => {
  const out = runInit(t, { answers: false, lsp: false })

  assert.match(out, /wired-but-empty/, 'wiring Graft in was reported as if evidence had been gathered')
  assert.doesNotMatch(out, /Graft: +passed/, '"passed" is exactly the word that hid this')
  assert.match(out, /repository map EMPTY/, 'an empty repository map was not reported as empty')
  assert.match(out, /0 of 4 structural queries returned evidence/, 'silent query misses were not counted')
})

test('a graph that answers is reported with how much of it answered', { skip }, t => {
  const out = runInit(t, { answers: true, lsp: false })

  assert.match(out, /indexed/)
  assert.match(out, /repository map available/)
  assert.match(out, /4 of 4 structural queries returned evidence/)
})

test('the outcome of the compiler-grade call-edge pass is recorded either way', { skip }, t => {
  // `graft init` builds parser-grade edges only. Whether the language-server pass ran changes
  // how much an unresolved caller means, so it cannot be left unsaid.
  const without = runInit(t, { answers: true, lsp: false })
  assert.match(without, /compiler-grade call edges: unavailable \(parser-grade edges only\)/)

  const with_ = runInit(t, { answers: true, lsp: true })
  assert.match(with_, /compiler-grade call edges: added/)
})

test('a language server that is not installed is not treated as a failure', { skip }, t => {
  // The graph from `graft init` is still valid without it, so the run must continue.
  const out = runInit(t, { answers: true, lsp: false })
  assert.match(out, /Stop gate:/, 'the initializer aborted when the optional --lsp pass declined to run')
})

test('the initializer attempts the call-edge pass rather than assuming it', { skip: false }, () => {
  const body = fs.readFileSync(INIT, 'utf8')
  assert.match(body, /graft build --lsp/, 'the graph is left parser-grade with no attempt to improve it')
})

test('the refresh states when no blast radius was computed', () => {
  // Same failure on the incremental path: collapsing "graft absent", "graft silent" and
  // "graft answered" into an empty string let the model read a missing section as a small
  // blast radius rather than an uncomputed one.
  const body = fs.readFileSync(path.join(ROOT, 'tools', 'refresh-baseline.sh'), 'utf8')
  assert.match(body, /GRAFT_EVIDENCE="not installed/)
  assert.match(body, /installed but returned nothing/)
  assert.match(body, /do not treat the absence of this section as evidence/)
})

test('the analysis prompt says so when there is no structural evidence at all', () => {
  const body = fs.readFileSync(INIT, 'utf8')
  assert.match(body, /No structural evidence was obtained for this repository/)
})
