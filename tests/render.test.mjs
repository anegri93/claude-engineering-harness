// The renderers are where model-supplied strings become file paths, rule filenames, YAML
// globs and durable instruction files in a user's repository. Each case runs them as real
// subprocesses against a throwaway directory, because the risk being covered is what they
// write to disk.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const TOOLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools')

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-render-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const MINIMAL_ANALYSIS = {
  summary: 'A fixture system.',
  architecture_summary: 'One layer that does one thing.'
}

function renderAnalysis(dir, structuredOutput, existingRules) {
  const input = path.join(dir, 'analysis-response.json')
  const out = path.join(dir, 'out')
  fs.writeFileSync(input, JSON.stringify({ structured_output: structuredOutput }))
  const extra = existingRules ? ['--existing-rules', existingRules] : []
  const stdout = execFileSync(process.execPath, [
    path.join(TOOLS, 'render-project-analysis.mjs'),
    '--input', input,
    '--out', out,
    '--name', 'fixture',
    ...extra
  ], { encoding: 'utf8', stdio: 'pipe' })
  return {
    out,
    result: JSON.parse(stdout),
    read: rel => fs.readFileSync(path.join(out, rel), 'utf8'),
    rules: () => fs.readdirSync(path.join(out, 'rules')).sort(),
    state: () => JSON.parse(fs.readFileSync(path.join(out, 'engineering-baseline.json'), 'utf8'))
  }
}

function renderRefresh(dir, current, refreshOutput, tag = 'a') {
  const currentPath = path.join(dir, `current-${tag}.json`)
  const responsePath = path.join(dir, `refresh-${tag}.json`)
  const out = path.join(dir, `out-${tag}`)
  fs.writeFileSync(currentPath, JSON.stringify(current))
  fs.writeFileSync(responsePath, JSON.stringify({ structured_output: refreshOutput }))
  const stdout = execFileSync(process.execPath, [
    path.join(TOOLS, 'render-baseline-refresh.mjs'),
    '--current', currentPath,
    '--response', responsePath,
    '--out', out
  ], { encoding: 'utf8', stdio: 'pipe' })
  return {
    result: JSON.parse(stdout),
    state: JSON.parse(fs.readFileSync(path.join(out, 'engineering-baseline.json'), 'utf8')),
    markdown: fs.readFileSync(path.join(out, 'engineering-baseline.md'), 'utf8')
  }
}

function finding(id, severity, extra = {}) {
  return {
    id,
    status: 'open',
    severity,
    title: `Finding ${id}`,
    detail: 'detail',
    evidence_paths: ['src/a.ts'],
    recommendation: 'do something',
    resolution: '',
    ...extra
  }
}

// --- render-project-analysis.mjs ---------------------------------------------------

test('analysis render refuses a response without structured output', t => {
  const dir = workspace(t)
  const input = path.join(dir, 'bad.json')
  fs.writeFileSync(input, JSON.stringify({ result: 'here is your analysis' }))
  assert.throws(() => execFileSync(process.execPath, [
    path.join(TOOLS, 'render-project-analysis.mjs'),
    '--input', input, '--out', path.join(dir, 'out'), '--name', 'fixture'
  ], { encoding: 'utf8', stdio: 'pipe' }), /structured_output/)
})

test('analysis render refuses a structured output missing the required summaries', t => {
  const dir = workspace(t)
  assert.throws(() => renderAnalysis(dir, { summary: 'only half of it' }),
    /summary or architecture_summary/)
})

test('escaping paths never reach evidence lines', t => {
  const dir = workspace(t)
  const rendered = renderAnalysis(dir, {
    ...MINIMAL_ANALYSIS,
    key_modules: [{
      path: 'src/app.ts',
      responsibility: 'Does the thing.',
      evidence_paths: ['../../etc/passwd', '/etc/shadow', '~/.ssh/id_rsa', 'C:/Windows/system32', 'src/app.ts']
    }]
  })
  const architecture = rendered.read(path.join('rules', 'project-architecture.md'))
  assert.match(architecture, /`src\/app\.ts`/)
  for (const rejected of ['../../etc/passwd', '/etc/shadow', '~/.ssh', 'C:/Windows']) {
    assert.ok(!architecture.includes(rejected), `${rejected} reached the rendered evidence`)
  }
})

test('escaping globs never reach rule frontmatter', t => {
  const dir = workspace(t)
  const rendered = renderAnalysis(dir, {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{
      title: 'Data',
      filename: 'data',
      paths: ['../outside/**', '/abs/**', 'src/**/*.sql'],
      rules: ['Parameterize queries.']
    }]
  })
  const rule = rendered.read(path.join('rules', 'harness-data.md'))
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(rule)
  assert.ok(frontmatter, 'generated rule has no frontmatter')
  assert.match(frontmatter[1], /src\/\*\*\/\*\.sql/)
  assert.ok(!frontmatter[1].includes('../outside'), 'a traversal glob reached frontmatter')
  assert.ok(!frontmatter[1].includes('/abs/'), 'an absolute glob reached frontmatter')
})

test('a rule filename cannot escape the rules directory or collide silently', t => {
  const dir = workspace(t)
  const rendered = renderAnalysis(dir, {
    ...MINIMAL_ANALYSIS,
    rule_groups: [
      { title: 'One', filename: '../../../etc/passwd', paths: ['src/**'], rules: ['a'] },
      { title: 'Two', filename: '../../../etc/passwd', paths: ['src/**'], rules: ['b'] },
      { title: 'Three', filename: 'project-architecture', paths: ['src/**'], rules: ['c'] }
    ]
  })
  const rules = rendered.rules()
  assert.equal(rules.length, 4, `expected 3 generated rules plus the architecture file, got ${rules}`)
  for (const name of rules) {
    assert.match(name, /^[a-z0-9.-]+\.md$/, `${name} is not a plain filename`)
  }
  assert.ok(rules.includes('project-architecture.md'))
  assert.ok(rules.includes('harness-architecture-details.md'), 'the architecture filename was not deconflicted')
  const deconflicted = rules.filter(name => /^harness-etc-passwd(-\d+)?\.md$/.test(name))
  assert.equal(deconflicted.length, 2, `colliding filenames were not suffixed: ${rules}`)
})

test('rule bodies cannot smuggle an import or a link target into an always-loaded file', t => {
  const dir = workspace(t)
  const rendered = renderAnalysis(dir, {
    ...MINIMAL_ANALYSIS,
    always_on_rules: ['@~/.ssh/config'],
    rule_groups: [{
      title: 'Ops',
      filename: 'ops',
      paths: ['src/**'],
      rationale: '@/etc/passwd is required reading.',
      rules: ['See [the runbook](file:///etc/passwd) before deploying.']
    }]
  })
  const rule = rendered.read(path.join('rules', 'harness-ops.md'))
  assert.ok(!rule.includes('@/etc/passwd'), 'a leading @ import survived into a rule body')
  assert.ok(!rule.includes('file:///etc/passwd'), 'a markdown link target survived into a rule body')
  assert.match(rule, /See the runbook before deploying\./)

  const managed = rendered.read('CLAUDE.managed.md')
  assert.ok(!managed.includes('@~/.ssh/config'), 'a leading @ import survived into CLAUDE.md')
})

test('the initial baseline seeds a finding-id counter above the highest id', t => {
  const dir = workspace(t)
  const rendered = renderAnalysis(dir, {
    ...MINIMAL_ANALYSIS,
    risks: [
      { severity: 'high', title: 'One', detail: 'd', evidence_paths: ['a.ts'], recommendation: 'r' },
      { severity: 'low', title: 'Two', detail: 'd', evidence_paths: ['b.ts'], recommendation: 'r' }
    ]
  })
  const state = rendered.state()
  assert.deepEqual(state.findings.map(f => f.id), ['F001', 'F002'])
  assert.equal(state.next_finding_id, 3)
})

// --- render-baseline-refresh.mjs ---------------------------------------------------

test('refresh render refuses a response without structured output', t => {
  const dir = workspace(t)
  const currentPath = path.join(dir, 'current.json')
  const responsePath = path.join(dir, 'response.json')
  fs.writeFileSync(currentPath, JSON.stringify({ findings: [] }))
  fs.writeFileSync(responsePath, JSON.stringify({ result: 'nothing structured here' }))
  assert.throws(() => execFileSync(process.execPath, [
    path.join(TOOLS, 'render-baseline-refresh.mjs'),
    '--current', currentPath, '--response', responsePath, '--out', path.join(dir, 'out')
  ], { encoding: 'utf8', stdio: 'pipe' }), /structured_output/)
})

test('a review updates its finding in place and keeps the id', t => {
  const dir = workspace(t)
  const current = { version: 2, findings: [finding('F001', 'high'), finding('F002', 'low')] }
  const { state, result } = renderRefresh(dir, current, {
    finding_reviews: [{
      finding_id: 'F002',
      status: 'resolved',
      severity: 'low',
      title: 'Finding F002',
      detail: 'detail',
      evidence_paths: ['src/a.ts'],
      recommendation: '',
      resolution: 'Fixed by the change under review.'
    }]
  })
  assert.deepEqual(state.findings.map(f => f.id), ['F001', 'F002'])
  assert.equal(state.findings[1].status, 'resolved')
  assert.equal(result.resolved, 1)
  assert.equal(result.changed, true)
})

test('a new finding takes the next id above the current maximum', t => {
  const dir = workspace(t)
  const current = { version: 2, findings: [finding('F001', 'high'), finding('F007', 'low')] }
  const { state } = renderRefresh(dir, current, {
    new_findings: [{ severity: 'medium', title: 'Brand new', detail: 'd', evidence_paths: ['src/b.ts'], recommendation: 'r' }]
  })
  assert.deepEqual(state.findings.map(f => f.id), ['F001', 'F007', 'F008'])
  assert.equal(state.next_finding_id, 9)
})

test('a new finding whose title only differs in punctuation is not appended twice', t => {
  const dir = workspace(t)
  const current = {
    version: 2,
    findings: [finding('F001', 'high', { title: 'Health endpoint returns 200 while degraded' })]
  }
  const { state, result } = renderRefresh(dir, current, {
    new_findings: [
      { severity: 'high', title: 'Health endpoint returns 200, while degraded.', detail: 'd', evidence_paths: [], recommendation: 'r' },
      { severity: 'high', title: 'Health endpoint returns 200, while degraded.', detail: 'd', evidence_paths: [], recommendation: 'r' }
    ]
  })
  assert.equal(result.added, 0)
  assert.equal(state.findings.length, 1)
})

test('active findings are capped, dropping the lowest severity first', t => {
  const dir = workspace(t)
  const findings = []
  for (let i = 1; i <= 25; i++) {
    findings.push(finding(`F${String(i).padStart(3, '0')}`, i <= 5 ? 'high' : 'low'))
  }
  const { state, result } = renderRefresh(dir, { version: 2, findings }, {})
  assert.equal(result.pruned, 5)
  assert.equal(state.findings.length, 20)
  for (let i = 1; i <= 5; i++) {
    assert.ok(state.findings.some(f => f.id === `F${String(i).padStart(3, '0')}`), `high-severity F00${i} was pruned`)
  }
  // Retention keeps the older findings within a severity, so the tail is what goes.
  assert.deepEqual(state.findings.map(f => f.id).slice(-1), ['F020'])
})

test('resolved and stale findings are capped separately from active ones', t => {
  const dir = workspace(t)
  const findings = []
  for (let i = 1; i <= 20; i++) {
    findings.push(finding(`F${String(i).padStart(3, '0')}`, 'low', { status: i % 2 ? 'resolved' : 'stale' }))
  }
  findings.push(finding('F021', 'high'))
  const { state } = renderRefresh(dir, { version: 2, findings }, {})
  assert.equal(state.findings.filter(f => ['resolved', 'stale'].includes(f.status)).length, 15)
  assert.ok(state.findings.some(f => f.id === 'F021'), 'the only active finding was pruned with the archive')
})

test('a pruned id is never handed to a different finding later', t => {
  const dir = workspace(t)
  const findings = []
  for (let i = 1; i <= 25; i++) {
    findings.push(finding(`F${String(i).padStart(3, '0')}`, i <= 5 ? 'high' : 'low'))
  }
  const first = renderRefresh(dir, { version: 2, findings }, {}, 'first')
  const survivors = new Set(first.state.findings.map(f => f.id))
  assert.ok(!survivors.has('F025'), 'nothing was pruned, so this test proves nothing')
  assert.equal(first.state.next_finding_id, 26)

  const second = renderRefresh(dir, first.state, {
    new_findings: [{ severity: 'critical', title: 'Later finding', detail: 'd', evidence_paths: [], recommendation: 'r' }]
  }, 'second')
  const added = second.state.findings.find(f => f.title === 'Later finding')
  assert.equal(added.id, 'F026', 'a new finding reused an id freed by pruning')
})

test('an escaping evidence path in a refresh never reaches the rendered baseline', t => {
  const dir = workspace(t)
  const current = { version: 2, findings: [finding('F001', 'high')] }
  const { markdown } = renderRefresh(dir, current, {
    new_findings: [{
      severity: 'high',
      title: 'Traversal',
      detail: 'd',
      evidence_paths: ['../../etc/passwd', '/etc/shadow', 'src/ok.ts'],
      recommendation: 'r'
    }]
  })
  assert.match(markdown, /`src\/ok\.ts`/)
  assert.ok(!markdown.includes('../../etc/passwd'))
  assert.ok(!markdown.includes('/etc/shadow'))
})

test('a refresh that changes nothing reports no change', t => {
  const dir = workspace(t)
  const current = { version: 2, findings: [finding('F001', 'high')], next_finding_id: 2 }
  const { result } = renderRefresh(dir, current, { finding_reviews: [], new_findings: [] })
  assert.equal(result.changed, false)
})

// project-architecture.md is always written; these cases are about the generated rule names.
function harnessRules(r) {
  return r.rules().filter(n => n.startsWith('harness-'))
}

// The analysis reads the repository, so on a re-initialization the model sees last run's
// `harness-<topic>.md` and echoes that name back as the filename. Prefixing it again turned
// every rerun into `harness-harness-<topic>`, then `harness-harness-harness-<topic>` — one
// more prefix per run, observed live on a real project. The prefix is the harness's ownership
// marker and is added by the renderer; it is never part of the topic the model names.
test('a filename the model already prefixed does not get prefixed again', t => {
  const dir = workspace(t)
  const r = renderAnalysis(dir, {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{
      title: 'Data layer',
      filename: 'harness-data-layer',
      paths: ['src/**'],
      rules: ['Keep queries parameterized.']
    }]
  })
  assert.deepEqual(harnessRules(r), ['harness-data-layer.md'])
})

test('repeated prefixes from earlier runs are all stripped', t => {
  const dir = workspace(t)
  const r = renderAnalysis(dir, {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{
      title: 'Testing',
      filename: 'harness-harness-harness-testing.md',
      paths: ['tests/**'],
      rules: ['Test behaviour, not shape.']
    }]
  })
  assert.deepEqual(harnessRules(r), ['harness-testing.md'])
})

test('rendering is idempotent: the same group renders to the same filename every run', t => {
  const group = {
    title: 'Auth and modes',
    filename: 'auth-y-modos',
    paths: ['src/auth/**'],
    rules: ['Authentication is not authorization.']
  }
  const first = renderAnalysis(workspace(t), { ...MINIMAL_ANALYSIS, rule_groups: [group] })
  assert.deepEqual(harnessRules(first), ['harness-auth-y-modos.md'])

  // What the model returns on the next run, having read the file the first run wrote.
  const second = renderAnalysis(workspace(t), {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{ ...group, filename: harnessRules(first)[0] }]
  })
  assert.deepEqual(harnessRules(second), harnessRules(first), 'a rerun renamed the rule instead of replacing it')
})

test('a filename that is nothing but the prefix falls back instead of vanishing', t => {
  const dir = workspace(t)
  const r = renderAnalysis(dir, {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{ title: '', filename: 'harness-', paths: ['src/**'], rules: ['Something.'] }]
  })
  assert.deepEqual(harnessRules(r), ['harness-project-rule-1.md'])
})

// A full re-analysis used to rename every rule file, because the model names the topic freely:
// the same group came back as `data-layer` on one run and `acceso-a-datos-y-cache` on the next.
// Six deletions and six additions in the diff, with no way to see what actually changed. The
// declared scope is the steady part — across two real runs on the same repository, four of six
// path sets were byte-identical and the other two only widened — so it is what identifies a
// rule across runs.
function withExistingRules(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-existing-rules-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const [name, paths] of Object.entries(files)) {
    const frontmatter = `---\npaths:\n${paths.map(p => `  - ${JSON.stringify(p)}`).join('\n')}\n---\n\n# rule\n`
    fs.writeFileSync(path.join(dir, name), frontmatter)
  }
  return dir
}

test('a renamed group keeps the filename of the rule whose scope it matches', t => {
  // The real case: same four paths, brand-new name from the model.
  const existing = withExistingRules(t, {
    'harness-data-layer.md': ['lib/queries.ts', 'app/(app)/**', 'app/(huesped)/**', 'app/**/datos.ts']
  })
  const r = renderAnalysis(workspace(t), {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{
      title: 'Acceso a datos y caché',
      filename: 'acceso-a-datos-y-cache',
      paths: ['lib/queries.ts', 'app/(app)/**', 'app/(huesped)/**', 'app/**/datos.ts'],
      rules: ['Queries live in one place.']
    }]
  }, existing)
  assert.deepEqual(harnessRules(r), ['harness-data-layer.md'])
})

test('a rule whose scope only widened keeps its filename', t => {
  // The other real case: `testing` gained `.github/workflows/**` and was renamed wholesale.
  const existing = withExistingRules(t, {
    'harness-testing.md': ['tests/**', 'vitest.config.ts', 'playwright.config.ts']
  })
  const r = renderAnalysis(workspace(t), {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{
      title: 'Estrategia de pruebas y entornos',
      filename: 'estrategia-de-pruebas-y-entornos',
      paths: ['tests/**', 'vitest.config.ts', 'playwright.config.ts', '.github/workflows/**'],
      rules: ['Test behaviour, not shape.']
    }]
  }, existing)
  assert.deepEqual(harnessRules(r), ['harness-testing.md'])
})

test('a genuinely different grouping gets a new filename', t => {
  const existing = withExistingRules(t, { 'harness-testing.md': ['tests/**'] })
  const r = renderAnalysis(workspace(t), {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{
      title: 'Migrations',
      filename: 'supabase-schema',
      paths: ['supabase/migrations/**'],
      rules: ['Migrations are append-only.']
    }]
  }, existing)
  assert.deepEqual(harnessRules(r), ['harness-supabase-schema.md'])
})

test('one existing rule cannot be claimed by two groups', t => {
  const existing = withExistingRules(t, { 'harness-frontend.md': ['components/**'] })
  const r = renderAnalysis(workspace(t), {
    ...MINIMAL_ANALYSIS,
    rule_groups: [
      { title: 'A', filename: 'kit-uno', paths: ['components/**'], rules: ['One.'] },
      { title: 'B', filename: 'kit-dos', paths: ['components/**'], rules: ['Two.'] }
    ]
  }, existing)
  assert.deepEqual(harnessRules(r), ['harness-frontend.md', 'harness-kit-dos.md'])
})

test('with no existing rules on disk the model name is used unchanged', t => {
  const r = renderAnalysis(workspace(t), {
    ...MINIMAL_ANALYSIS,
    rule_groups: [{ title: 'Data', filename: 'data-layer', paths: ['lib/**'], rules: ['One.'] }]
  })
  assert.deepEqual(harnessRules(r), ['harness-data-layer.md'])
})
