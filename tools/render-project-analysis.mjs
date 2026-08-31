#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { severityOf, severityRank, severityLabel, verdictOf, CARRY } from './severity.mjs'

function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`)
    }
    out[key.slice(2)] = value
  }
  return out
}

function requireArg(args, name) {
  const value = args[name]
  if (!value) throw new Error(`Missing --${name}`)
  return value
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function list(value, max = 50) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).slice(0, max)
    : []
}

function safeRepoPath(value) {
  const v = text(value).replaceAll('\\', '/')
  if (!v || v.startsWith('/') || v.startsWith('~') || v.includes('../') || v === '..') return ''
  if (/^[A-Za-z]:\//.test(v)) return ''
  return v
}

function safeGlob(value) {
  const v = safeRepoPath(value)
  if (!v || v.length > 240 || v.includes('\n') || v.includes('\r')) return ''
  return v
}

function safeSlug(value, fallback = 'project-rule') {
  const raw = text(value).toLowerCase().replace(/\.md$/i, '')
  const slug = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || fallback
}

function mdInline(value) {
  return text(value).replaceAll('`', '\\`').replace(/\s+/g, ' ')
}

// Rule bodies are model-authored text derived from the analyzed repository, and they are
// written into files Claude Code loads as instructions in every future session. Paths,
// globs and filenames are sanitized separately; this neutralizes the two constructs in a
// body that would be acted on rather than read — a leading `@`, which Claude Code resolves
// as a file import, and markdown link/image targets.
function safeRuleText(value) {
  return text(value)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split('\n')
    .map((line) => line.replace(/^(\s*)@/, '$1'))
    .join('\n')
}

function bullet(value) {
  return `- ${safeRuleText(value).replace(/\s+/g, ' ')}`
}

function pathCode(value) {
  return `\`${mdInline(value)}\``
}

function evidence(paths) {
  const clean = list(paths, 12).map(safeRepoPath).filter(Boolean)
  return clean.length ? clean.map(pathCode).join(', ') : 'No specific path recorded'
}

function yamlFrontmatter(paths) {
  const clean = [...new Set(list(paths, 12).map(safeGlob).filter(Boolean))]
  if (!clean.length) return ''
  return `---\npaths:\n${clean.map((p) => `  - ${JSON.stringify(p)}`).join('\n')}\n---\n\n`
}

// A full re-analysis renames every rule file: the model picks the topic name freely, so the
// same group came back as `data-layer` on one run and `acceso-a-datos-y-cache` on the next.
// Six files deleted and six added in the diff, with nothing to show what actually changed.
//
// The scope is far steadier than the name — measured across two real runs, four of six path
// sets were byte-identical and the other two only widened. So an existing rule file whose
// declared scope is the same set, or a subset, or a superset, is the same rule: it keeps its
// filename and the diff shows the edit instead of a rename. Anything else is a genuinely
// different grouping and gets the model's name.
function existingRules(dir) {
  if (!dir) return []
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!/^harness-.+\.md$/.test(name)) continue
    let body
    try {
      body = fs.readFileSync(path.join(dir, name), 'utf8')
    } catch {
      continue
    }
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(body)
    if (!frontmatter) continue
    const paths = new Set()
    for (const line of frontmatter[1].split('\n')) {
      const m = /^\s*-\s*"(.*)"\s*$/.exec(line)
      if (m) paths.add(m[1])
    }
    if (paths.size) out.push({ slug: name.replace(/^harness-/, '').replace(/\.md$/, ''), scope: scopeOf(paths) })
  }
  return out
}

// Scope identity is the area a rule covers, not the exact spelling of the globs that cover it.
// `app/**/*.css` and `app/*.css` reach the same area; the model returned one on one run and the
// other on the next, and that one character renamed a rule whose content had not moved. A `**`
// segment says how deep a glob descends inside an area, never which area is meant, so it is
// dropped before comparing. Only for comparing: the frontmatter written to the file keeps the
// glob exactly as the model wrote it, because there the depth is the meaning.
function scopeOf(paths) {
  const out = new Set()
  for (const value of paths) {
    const normalized = String(value)
      .trim()
      .replace(/^\.\//, '')
      .replace(/\/{2,}/g, '/')
      .split('/')
      .filter((segment) => segment !== '**')
      .join('/')
      .replace(/\/+$/, '')
    if (normalized) out.add(normalized)
  }
  return out
}

// Same set, or one contains the other. No similarity threshold: a rule whose scope grew or
// shrank is still that rule, and anything else is a different one.
function sameScope(a, b) {
  if (!a.size || !b.size) return false
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const value of small) if (!large.has(value)) return false
  return true
}

const args = parseArgs(process.argv)
const inputPath = requireArg(args, 'input')
const outDir = requireArg(args, 'out')
const projectName = requireArg(args, 'name')
const existing = existingRules(args['existing-rules'])
const claimedExisting = new Set()
const kind = args.kind || 'Unknown'
const stack = args.stack || 'Unknown'
const packageManager = args['package-manager'] || 'Not detected'
const monorepo = args.monorepo || 'false'
const installCommand = args.install || 'Not detected'
const devCommand = args.dev || 'Not detected'
const testCommand = args.test || 'Not detected'
const lintCommand = args.lint || 'Not detected'
const typecheckCommand = args.typecheck || 'Not detected'
const buildCommand = args.build || 'Not detected'

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const analysis = payload?.structured_output
if (!analysis || typeof analysis !== 'object') {
  throw new Error('Claude response does not contain structured_output')
}

const summary = safeRuleText(analysis.summary)
const architectureSummary = safeRuleText(analysis.architecture_summary)
if (!summary || !architectureSummary) {
  throw new Error('Claude analysis is missing summary or architecture_summary')
}

const modules = Array.isArray(analysis.key_modules) ? analysis.key_modules.slice(0, 16) : []
const alwaysOnRules = list(analysis.always_on_rules, 12)
const invariants = Array.isArray(analysis.business_invariants) ? analysis.business_invariants.slice(0, 12) : []
const groups = Array.isArray(analysis.rule_groups) ? analysis.rule_groups.slice(0, 8) : []
const risks = Array.isArray(analysis.risks) ? analysis.risks.slice(0, 10) : []
const confidenceNotes = list(analysis.confidence_notes, 10)

fs.mkdirSync(path.join(outDir, 'rules'), { recursive: true })

const managed = []
managed.push('<!-- CLAUDE-ENGINEERING-HARNESS:BEGIN -->')
managed.push('# Project Engineering Context')
managed.push('')
managed.push('This repository uses the global Claude Engineering Harness. Repository-specific facts below were derived from a read-only codebase analysis. Preserve existing architecture unless a requested change intentionally alters it.')
managed.push('')
managed.push('## Project')
managed.push('')
managed.push(`- Name: ${mdInline(projectName)}`)
managed.push(`- Kind: ${mdInline(kind)}`)
managed.push(`- Stack: ${mdInline(stack)}`)
managed.push(`- Package manager: ${mdInline(packageManager)}`)
managed.push(`- Monorepo: ${mdInline(monorepo)}`)
managed.push('')
managed.push('## System summary')
managed.push('')
managed.push(summary)
managed.push('')
managed.push('## Architecture')
managed.push('')
managed.push(architectureSummary)
managed.push('')

if (modules.length) {
  managed.push('## Key boundaries')
  managed.push('')
  for (const item of modules.slice(0, 10)) {
    const p = safeRepoPath(item?.path)
    const responsibility = text(item?.responsibility)
    if (!p || !responsibility) continue
    managed.push(`- ${pathCode(p)}: ${safeRuleText(responsibility).replace(/\s+/g, ' ')}`)
  }
  managed.push('')
}

if (alwaysOnRules.length) {
  managed.push('## Repository-specific rules')
  managed.push('')
  for (const rule of alwaysOnRules) managed.push(bullet(rule))
  managed.push('')
}

if (invariants.length) {
  managed.push('## Business invariants')
  managed.push('')
  for (const item of invariants.slice(0, 8)) {
    const rule = text(item?.rule)
    if (rule) managed.push(bullet(rule))
  }
  managed.push('')
}

managed.push('## Commands')
managed.push('')
managed.push(`- Install: \`${mdInline(installCommand)}\``)
managed.push(`- Development: \`${mdInline(devCommand)}\``)
managed.push(`- Lint: \`${mdInline(lintCommand)}\``)
managed.push(`- Typecheck: \`${mdInline(typecheckCommand)}\``)
managed.push(`- Test: \`${mdInline(testCommand)}\``)
managed.push(`- Build: \`${mdInline(buildCommand)}\``)
managed.push('- Verification gate: `.claude/verify.sh`')
managed.push('')
managed.push('Detailed conditional rules live under `.claude/rules/`. The living engineering baseline is available at `.claude/engineering-baseline.md` and is refreshed automatically after verified Claude Code edits.')
managed.push('<!-- CLAUDE-ENGINEERING-HARNESS:END -->')
managed.push('')
fs.writeFileSync(path.join(outDir, 'CLAUDE.managed.md'), managed.join('\n'))

const architecture = []
architecture.push('<!-- generated-by: claude-engineering-harness -->')
architecture.push('# Project Architecture')
architecture.push('')
architecture.push(architectureSummary)
architecture.push('')
if (modules.length) {
  architecture.push('## Module responsibilities')
  architecture.push('')
  for (const item of modules) {
    const p = safeRepoPath(item?.path)
    const responsibility = text(item?.responsibility)
    if (!p || !responsibility) continue
    const deps = list(item?.depends_on, 8).map(safeRepoPath).filter(Boolean)
    architecture.push(`### ${pathCode(p)}`)
    architecture.push('')
    architecture.push(safeRuleText(responsibility))
    if (deps.length) architecture.push(`- Depends on: ${deps.map(pathCode).join(', ')}`)
    architecture.push(`- Evidence: ${evidence(item?.evidence_paths)}`)
    architecture.push('')
  }
}
architecture.push('## Guardrails')
architecture.push('')
architecture.push('- Preserve the dependency direction and responsibilities documented above when extending existing modules.')
architecture.push('- Inspect the public API and nearby callers before introducing a cross-boundary dependency.')
architecture.push('- If implementation evidence conflicts with this generated description, prefer current code and refresh the harness analysis.')
architecture.push('')
fs.writeFileSync(path.join(outDir, 'rules', 'project-architecture.md'), architecture.join('\n'))

const generatedNames = []
const used = new Set(['project-architecture'])
for (let i = 0; i < groups.length; i++) {
  const group = groups[i]
  // The `harness-` prefix is added below, and it is the harness's ownership marker — never
  // part of the topic. Strip any the model supplied: it reads the repository, so on a re-run
  // it sees last run's `harness-<topic>.md` and echoes that name back. Prefixing again turned
  // every re-initialization into `harness-harness-<topic>`, then `harness-harness-harness-`,
  // growing by one each time. Stripping here makes the filename idempotent whatever it returns.
  let slug = safeSlug(group?.filename || group?.title, `project-rule-${i + 1}`)
    .replace(/^(?:harness-)+/, '')
    .replace(/^harness$/, '')
  if (!slug) slug = `project-rule-${i + 1}`
  if (slug === 'project-architecture') slug = 'architecture-details'

  const groupScope = scopeOf(list(group?.paths, 12).map(safeGlob).filter(Boolean))
  const match = existing.find((rule) => !claimedExisting.has(rule.slug) && sameScope(rule.scope, groupScope))
  if (match) {
    claimedExisting.add(match.slug)
    slug = match.slug
  }
  let finalSlug = slug
  let suffix = 2
  while (used.has(finalSlug)) finalSlug = `${slug}-${suffix++}`
  used.add(finalSlug)

  const filename = `harness-${finalSlug}.md`
  const rules = list(group?.rules, 16)
  if (!rules.length) continue

  const doc = []
  doc.push(yamlFrontmatter(group?.paths).trimEnd())
  if (doc[0] === '') doc.shift()
  doc.push('<!-- generated-by: claude-engineering-harness -->')
  doc.push(`# ${safeRuleText(group?.title).replace(/\s+/g, ' ') || finalSlug}`)
  doc.push('')
  const rationale = safeRuleText(group?.rationale)
  if (rationale) {
    doc.push(rationale)
    doc.push('')
  }
  for (const rule of rules) doc.push(bullet(rule))
  doc.push('')
  doc.push(`Evidence used during harness analysis: ${evidence(group?.evidence_paths)}`)
  doc.push('')

  fs.writeFileSync(path.join(outDir, 'rules', filename), doc.join('\n'))
  generatedNames.push(filename)
}

// Severity is derived from the reported axes, never taken from the model. See tools/severity.mjs
// for why: an unwritten scale drifts between runs, and the retention cap prunes by it.
risks.sort((a, b) => severityRank(severityOf(a)) - severityRank(severityOf(b)))

const baselineState = {
  version: 2,
  system_summary: summary,
  architecture_summary: architectureSummary,
  business_invariants: invariants.map((item, index) => ({
    id: `I${String(index + 1).padStart(3, '0')}`,
    rule: text(item?.rule),
    evidence_paths: list(item?.evidence_paths, 8).map(safeRepoPath).filter(Boolean),
  })).filter((item) => item.rule),
  confidence_notes: confidenceNotes,
  findings: risks.map((risk, index) => ({
    id: `F${String(index + 1).padStart(3, '0')}`,
    status: 'open',
    impact: text(risk?.impact),
    trigger: text(risk?.trigger),
    blast_radius: text(risk?.blast_radius),
    fix_cost: text(risk?.fix_cost),
    severity: severityOf(risk),
    title: text(risk?.title) || 'Finding',
    detail: text(risk?.detail),
    example: text(risk?.example),
    evidence_paths: list(risk?.evidence_paths, 8).map(safeRepoPath).filter(Boolean),
    recommendation: text(risk?.recommendation),
    resolution: '',
  })),
  next_finding_id: risks.length + 1,
  full_reanalysis_recommended: false,
  full_reanalysis_reason: '',
}

function renderFinding(baseline, finding) {
  const severity = severityLabel(finding?.severity)
  const status = text(finding?.status).toUpperCase() || 'OPEN'
  const title = text(finding?.title) || 'Finding'
  baseline.push(`### [${status}] ${severity} — ${title} · ${text(finding?.id)}`)
  baseline.push('')
  if (text(finding?.detail)) baseline.push(text(finding.detail))
  baseline.push('')
  // The axes say how bad it would be; only the example says what actually goes wrong, which is
  // what lets a reader throw the finding out. A finding that arrived without one says so rather
  // than rendering as though the mechanism were self-evident.
  baseline.push(text(finding?.example) ? `**Example.** ${text(finding.example).replace(/\s+/g, ' ')}` : '**Example.** Not provided.')
  baseline.push('')
  baseline.push(`- Evidence: ${evidence(finding?.evidence_paths)}`)
  // Same line the refresh renderer writes: the initial baseline and every later one are the same
  // artifact, and a reader should be able to argue with the inputs rather than the verdict.
  if (text(finding?.impact) && text(finding?.trigger)) {
    baseline.push(`- Rated: ${text(finding.impact)} × ${text(finding.trigger)} × ${text(finding?.blast_radius) || 'component'}`)
  } else {
    baseline.push('- Rated: not measured')
  }
  // The cost is the other half of the verdict that files a finding as carried, so it is shown
  // beside the rating: a reader can then argue with the input rather than only with the section.
  if (text(finding?.fix_cost)) baseline.push(`- Fix cost: ${text(finding.fix_cost)}`)
  if (text(finding?.recommendation)) baseline.push(`- Incremental recommendation: ${text(finding.recommendation).replace(/\s+/g, ' ')}`)
  if (text(finding?.resolution)) baseline.push(`- Resolution note: ${text(finding.resolution).replace(/\s+/g, ' ')}`)
  baseline.push('')
}

const baseline = []
baseline.push('<!-- generated-by: claude-engineering-harness -->')
baseline.push('# Engineering Baseline')
baseline.push('')
baseline.push('Living engineering baseline generated from repository evidence. Findings are advisory and must always be revalidated against current source and tests before action. The harness refreshes affected findings automatically after verified Claude Code changes.')
baseline.push('')
baseline.push('## System')
baseline.push('')
baseline.push(summary)
baseline.push('')
baseline.push('## Architecture')
baseline.push('')
baseline.push(architectureSummary)
baseline.push('')

// Harm and cost are reported separately and crossed in tools/severity.mjs. A finding that is real
// but costs more to remove than the harm it carries is filed here rather than dropped: deleting it
// would make the analysis unreproducible, and leaving it among the actionable ones is what buried
// them in the first place.
const unarchived = baselineState.findings.filter((f) => !['resolved', 'stale'].includes(f.status))
const active = unarchived.filter((f) => verdictOf(f) !== CARRY)
const carried = unarchived.filter((f) => verdictOf(f) === CARRY)

baseline.push('## Active findings')
baseline.push('')
if (active.length) for (const finding of active) renderFinding(baseline, finding)
else baseline.push('No active engineering findings are currently recorded.')

if (carried.length) {
  baseline.push('')
  baseline.push('## Carried findings — not worth the fix')
  baseline.push('')
  // Counted out loud rather than silently omitted: absence is not data, and a reader has to be able
  // to see that these were measured and set aside, not that nothing was found.
  baseline.push(`${carried.length} finding(s) are real but cost more to remove than the harm they carry. They are recorded, not scheduled. Revisit one when its area is being changed anyway, or when new evidence raises its rating.`)
  baseline.push('')
  for (const finding of carried) renderFinding(baseline, finding)
}

const resolved = baselineState.findings.filter((f) => f.status === 'resolved')
if (resolved.length) {
  baseline.push('## Resolved findings')
  baseline.push('')
  for (const finding of resolved) renderFinding(baseline, finding)
}

const stale = baselineState.findings.filter((f) => f.status === 'stale')
if (stale.length) {
  baseline.push('## Stale findings')
  baseline.push('')
  for (const finding of stale) renderFinding(baseline, finding)
}

if (baselineState.business_invariants.length) {
  baseline.push('## Evidenced business invariants')
  baseline.push('')
  for (const item of baselineState.business_invariants) {
    baseline.push(`${bullet(item.rule)} [${item.id}]`)
    baseline.push(`  - Evidence: ${evidence(item.evidence_paths)}`)
  }
  baseline.push('')
}

if (confidenceNotes.length) {
  baseline.push('## Analysis limitations')
  baseline.push('')
  for (const note of confidenceNotes) baseline.push(bullet(note))
  baseline.push('')
}

baseline.push('A full architecture/rule regeneration still comes from `~/.claude/harness-tools/init-project.sh`; routine finding freshness is automatic on Claude Code Stop after successful verification.')
baseline.push('')
fs.writeFileSync(path.join(outDir, 'engineering-baseline.md'), baseline.join('\n'))
fs.writeFileSync(path.join(outDir, 'engineering-baseline.json'), JSON.stringify(baselineState, null, 2) + '\n')
fs.writeFileSync(path.join(outDir, 'generated-rules.txt'), [...generatedNames, 'project-architecture.md'].join('\n') + '\n')
fs.writeFileSync(path.join(outDir, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n')

console.log(JSON.stringify({
  generated_rule_count: generatedNames.length + 1,
  risk_count: risks.length,
  carried_count: carried.length,
  always_on_rule_count: alwaysOnRules.length,
  module_count: modules.length
}))
