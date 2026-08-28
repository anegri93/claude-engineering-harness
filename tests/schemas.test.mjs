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
