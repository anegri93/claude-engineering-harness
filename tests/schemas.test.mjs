// The two JSON schemas are configuration consumed by an external tool at runtime: each is
// read, newline-stripped and handed to `claude --json-schema`. Nothing validated them, and
// the failure is asymmetric — a malformed analysis schema aborts init loudly, but a malformed
// refresh schema hits the fail-soft path, which prints "refresh deferred", keeps the dirty
// marker and exits 0 on every Stop. The living baseline dies and nobody is told.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = path.join(ROOT, 'src', 'harness')

const SCHEMAS = ['project-analysis-schema.json', 'baseline-refresh-schema.json']

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(HARNESS, name), 'utf8'))
}

test('every shipped schema parses as JSON', () => {
  for (const name of SCHEMAS) {
    assert.doesNotThrow(() => load(name), `${name} is not valid JSON`)
  }
})

test('every shipped schema survives the newline stripping the callers apply', () => {
  // Both scripts do `tr -d '\n' < "$SCHEMA_FILE"` before passing the value on the command
  // line, so a schema containing a newline inside a string literal would silently change
  // meaning rather than fail.
  for (const name of SCHEMAS) {
    const raw = fs.readFileSync(path.join(HARNESS, name), 'utf8')
    const stripped = raw.replace(/\n/g, '')
    assert.doesNotThrow(() => JSON.parse(stripped), `${name} does not survive newline stripping`)
    assert.deepEqual(JSON.parse(stripped), JSON.parse(raw), `${name} changes meaning when newlines are stripped`)
  }
})

test('every shipped schema is a closed object schema', () => {
  // `additionalProperties: false` is what makes the model's output a contract rather than a
  // suggestion. A schema that silently allows extra keys lets a renamed field pass validation
  // while the renderer reads the old name and produces an empty section.
  for (const name of SCHEMAS) {
    const schema = load(name)
    assert.equal(schema.type, 'object', `${name} is not an object schema`)
    assert.equal(schema.additionalProperties, false, `${name} does not close its top level`)
    assert.ok(Array.isArray(schema.required) && schema.required.length > 0, `${name} requires nothing`)
  }
})

test('every schema property named in `required` is actually defined', () => {
  const walk = (node, name, at) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, name, `${at}[${i}]`))
      return
    }
    if (Array.isArray(node.required) && node.properties) {
      for (const key of node.required) {
        assert.ok(
          Object.hasOwn(node.properties, key),
          `${name}: ${at} requires "${key}" but never defines it, so no response can validate`,
        )
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'required') continue
      walk(child, name, `${at}.${key}`)
    }
  }
  for (const name of SCHEMAS) walk(load(name), name, '$')
})

// The renderers read the model's response by key. A schema that stops producing a key the
// renderer reads does not fail loudly: it renders an empty or default section that looks
// exactly like a genuine "nothing found".
const RENDERER_CONTRACTS = [
  {
    schema: 'project-analysis-schema.json',
    renderer: 'render-project-analysis.mjs',
  },
  {
    schema: 'baseline-refresh-schema.json',
    renderer: 'render-baseline-refresh.mjs',
  },
]

test('every top-level schema key is read by its renderer', () => {
  for (const { schema, renderer } of RENDERER_CONTRACTS) {
    const keys = Object.keys(load(schema).properties ?? {})
    assert.ok(keys.length > 0, `${schema} declares no properties`)
    const source = fs.readFileSync(path.join(ROOT, 'tools', renderer), 'utf8')
    const unread = keys.filter(key => !source.includes(key))
    assert.deepEqual(
      unread,
      [],
      `${schema} asks the model for keys ${renderer} never reads: the cost is paid and the answer discarded`,
    )
  }
})

// A status the schema allows but the renderer does not file goes somewhere by accident. Both
// `accepted` and `invalid` are archived rather than active — one records a decision to carry a
// real risk, the other that the claim was never true — and a renderer that treated either as
// ordinary open work would put it back in the list that asks for action every session.
test('every finding status the schema allows is filed by the refresh renderer', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'harness', 'baseline-refresh-schema.json'), 'utf8'))
  const renderer = fs.readFileSync(path.join(ROOT, 'tools', 'render-baseline-refresh.mjs'), 'utf8')

  const statuses = new Set()
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (node.properties?.status?.enum) for (const value of node.properties.status.enum) statuses.add(value)
    for (const value of Object.values(node)) walk(value)
  }
  walk(schema)
  assert.ok(statuses.has('invalid'), 'the schema offers no way to close a false positive')

  const archived = /const ARCHIVED_STATUSES *= *\[([^\]]*)\]/.exec(renderer)
  assert.ok(archived, 'could not find ARCHIVED_STATUSES in the refresh renderer')
  for (const status of ['resolved', 'stale', 'accepted', 'invalid']) {
    assert.match(archived[1], new RegExp(`'${status}'`), `${status} is not archived by the renderer`)
  }
  for (const status of statuses) {
    assert.match(renderer, new RegExp(`'${status}'`), `the renderer never mentions the status ${status}`)
  }
})

// The read-only analysis runs with cwd set to the repository and `--tools "Read,Glob,Grep"`, so
// it cannot see ~/.claude — where every harness hook, marker and setting actually lives. It once
// read a project settings.json, saw no harness hook and no .claude/verify-on-stop, and filed a
// HIGH-adjacent finding saying the harness was not running. Both markers are removed from
// repositories on purpose; the analysis was reasoning from something it had no access to.
test('both analysis prompts put the harness wiring out of scope', () => {
  for (const name of ['project-analysis-prompt.md', 'baseline-refresh-prompt.md']) {
    const body = fs.readFileSync(path.join(ROOT, 'src', 'harness', name), 'utf8')
    assert.match(body, /verify-on-stop/, `${name} does not name the markers whose absence misled the analysis`)
    assert.match(body, /~\/\.claude/, `${name} does not say where the harness wiring actually lives`)
  }
})
