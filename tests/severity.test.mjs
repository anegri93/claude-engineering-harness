// Severity used to be whatever the model called it. The same finding came back `medium` on one
// run and `low` on the next, two projects' mediums meant different things, and the retention cap
// dropped findings by that drift. The model now reports three grounded facts and this table turns
// them into the rating, so the table is the thing that has to be pinned — exhaustively, because a
// single wrong cell is invisible in prose and silently changes which finding survives the cap.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  severityOf,
  resolveSeverity,
  severityRank,
  severityLabel,
  UNRATED,
  IMPACT,
  TRIGGER,
  BLAST_RADIUS,
  SEVERITY_LEVELS,
} from '../tools/severity.mjs'

function walk(node, visit, key) {
  if (Array.isArray(node)) { for (const item of node) walk(item, visit) ; return }
  if (!node || typeof node !== 'object') return
  visit(node, key)
  for (const [k, v] of Object.entries(node)) walk(v, visit, k)
}

// Written out rather than derived from the module: a table generated from the same source it
// verifies proves only that the source equals itself.
const EXPECTED = {
  data_loss:        { already_occurring: 'critical', normal_use: 'critical', specific_conditions: 'medium', hypothetical: 'medium' },
  security:         { already_occurring: 'critical', normal_use: 'high',     specific_conditions: 'high',   hypothetical: 'medium' },
  incorrect_result: { already_occurring: 'high',     normal_use: 'high',     specific_conditions: 'medium', hypothetical: 'low' },
  maintenance:      { already_occurring: 'medium',   normal_use: 'medium',   specific_conditions: 'low',    hypothetical: 'low' },
  cosmetic:         { already_occurring: 'low',      normal_use: 'low',      specific_conditions: 'low',    hypothetical: 'low' },
}

test('every impact/trigger pair maps to the agreed level at a neutral blast radius', () => {
  for (const impact of IMPACT) {
    for (const trigger of TRIGGER) {
      assert.equal(
        severityOf({ impact, trigger, blast_radius: 'component' }),
        EXPECTED[impact][trigger],
        `${impact} x ${trigger} is not the agreed level`
      )
    }
  }
})

// The schemas tell the model which values exist; TABLE decides what each one rates as. They are two
// copies of one vocabulary, and the drift fails in the passing direction: rename a value in a schema
// and the model returns it, `severityOf` finds no row, every finding using it renders NOT MEASURED,
// sorts last, and is the first thing the retention cap drops. Nothing exits non-zero. So compare the
// copies mechanically, the way tests/hooks.test.mjs compares the duplicated ignore lists, rather
// than restating the values here and calling that a check.
test('every schema offers exactly the axis values the severity table rates', () => {
  const schemaDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'harness')
  const sites = []
  for (const name of ['project-analysis-schema.json', 'baseline-refresh-schema.json']) {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, name), 'utf8'))
    walk(schema, (node, key) => {
      if (['impact', 'trigger', 'blast_radius'].includes(key) && Array.isArray(node?.enum)) {
        sites.push({ file: name, axis: key, values: node.enum })
      }
    })
  }
  // project-analysis defines the axes once; baseline-refresh defines them for reviews and for new
  // findings. Three sites, three axes: if a site disappears, this count catches it before the
  // comparison below silently passes over nothing.
  assert.equal(sites.length, 9, `expected 9 axis enums across the schemas, found ${sites.length}`)

  const expected = { impact: IMPACT, trigger: TRIGGER, blast_radius: BLAST_RADIUS }
  for (const site of sites) {
    assert.deepEqual(site.values, expected[site.axis],
      `${site.file} offers a different ${site.axis} vocabulary than tools/severity.mjs rates`)
  }
  assert.deepEqual(SEVERITY_LEVELS, ['critical', 'high', 'medium', 'low'])
})

test('a system-wide blast radius raises the level by one', () => {
  // security x hypothetical is medium; reaching every project the harness touches makes it high.
  assert.equal(severityOf({ impact: 'security', trigger: 'hypothetical', blast_radius: 'system_wide' }), 'high')
  assert.equal(severityOf({ impact: 'maintenance', trigger: 'specific_conditions', blast_radius: 'system_wide' }), 'medium')
})

test('a local blast radius lowers the level by one', () => {
  assert.equal(severityOf({ impact: 'incorrect_result', trigger: 'normal_use', blast_radius: 'local' }), 'medium')
  assert.equal(severityOf({ impact: 'maintenance', trigger: 'specific_conditions', blast_radius: 'local' }), 'low')
})

test('the modifier cannot invent a critical', () => {
  // Without this guard the harness inflates itself: it is system-wide by nature, so every latent
  // security weakness in it would climb to the top level and `critical` would stop meaning
  // anything. Only the base table may produce one.
  assert.equal(severityOf({ impact: 'security', trigger: 'normal_use', blast_radius: 'system_wide' }), 'high')
  assert.equal(severityOf({ impact: 'security', trigger: 'specific_conditions', blast_radius: 'system_wide' }), 'high')
  assert.equal(severityOf({ impact: 'incorrect_result', trigger: 'already_occurring', blast_radius: 'system_wide' }), 'high')
})

test('a base critical survives a lowering modifier only by one level', () => {
  assert.equal(severityOf({ impact: 'data_loss', trigger: 'already_occurring', blast_radius: 'local' }), 'high')
  assert.equal(severityOf({ impact: 'data_loss', trigger: 'already_occurring', blast_radius: 'system_wide' }), 'critical')
})

test('the lowest level cannot be lowered off the end of the scale', () => {
  assert.equal(severityOf({ impact: 'cosmetic', trigger: 'hypothetical', blast_radius: 'local' }), 'low')
})

test('a missing blast radius is treated as neutral rather than rejected', () => {
  assert.equal(severityOf({ impact: 'security', trigger: 'hypothetical' }), 'medium')
  assert.equal(severityOf({ impact: 'security', trigger: 'hypothetical', blast_radius: 'nonsense' }), 'medium')
})

test('an unmeasured axis is unrated, never the least alarming level', () => {
  // Absence is not data. A finding whose axes never arrived must not read as a mild one.
  assert.equal(severityOf({ trigger: 'already_occurring', blast_radius: 'component' }), UNRATED)
  assert.equal(severityOf({ impact: 'security', blast_radius: 'component' }), UNRATED)
  assert.equal(severityOf({}), UNRATED)
  assert.equal(severityOf({ impact: 'invented', trigger: 'already_occurring' }), UNRATED)
  assert.notEqual(severityOf({}), 'low')
})

test('a baseline written before the axes existed keeps the rating it was given', () => {
  // Forcing every stored finding to unrated on upgrade would throw away real information, so a
  // legacy rating stands until a refresh reviews that finding and supplies axes.
  assert.deepEqual(resolveSeverity({ severity: 'high' }), { severity: 'high', legacy: true })
  assert.deepEqual(
    resolveSeverity({ severity: 'low', impact: 'data_loss', trigger: 'normal_use', blast_radius: 'component' }),
    { severity: 'critical', legacy: false }
  )
  assert.deepEqual(resolveSeverity({ severity: 'not-a-level' }), { severity: UNRATED, legacy: false })
  assert.deepEqual(resolveSeverity({}), { severity: UNRATED, legacy: false })
})

test('unrated findings sort after every rated one', () => {
  const order = ['low', UNRATED, 'critical', 'medium', 'high']
  order.sort((a, b) => severityRank(a) - severityRank(b))
  assert.deepEqual(order, ['critical', 'high', 'medium', 'low', UNRATED])
})

test('an unrated finding is labelled as unmeasured, not as a level', () => {
  assert.equal(severityLabel(UNRATED), 'NOT MEASURED')
  assert.equal(severityLabel('high'), 'HIGH')
  assert.equal(severityLabel(''), 'NOT MEASURED')
})
