#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

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

function bullet(value) {
  return `- ${text(value).replace(/\s+/g, ' ')}`
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

const args = parseArgs(process.argv)
const inputPath = requireArg(args, 'input')
const outDir = requireArg(args, 'out')
const projectName = requireArg(args, 'name')
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

const summary = text(analysis.summary)
const architectureSummary = text(analysis.architecture_summary)
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
    managed.push(`- ${pathCode(p)}: ${responsibility.replace(/\s+/g, ' ')}`)
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
    architecture.push(responsibility)
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
  let slug = safeSlug(group?.filename || group?.title, `project-rule-${i + 1}`)
  if (slug === 'project-architecture') slug = 'architecture-details'
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
  doc.push(`# ${text(group?.title) || finalSlug}`)
  doc.push('')
  const rationale = text(group?.rationale)
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

const order = { critical: 0, high: 1, medium: 2, low: 3 }
risks.sort((a, b) => (order[text(a?.severity)] ?? 9) - (order[text(b?.severity)] ?? 9))

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
    severity: text(risk?.severity) || 'low',
    title: text(risk?.title) || 'Finding',
    detail: text(risk?.detail),
    evidence_paths: list(risk?.evidence_paths, 8).map(safeRepoPath).filter(Boolean),
    recommendation: text(risk?.recommendation),
    resolution: '',
  })),
  full_reanalysis_recommended: false,
  full_reanalysis_reason: '',
}

function renderFinding(baseline, finding) {
  const severity = text(finding?.severity).toUpperCase() || 'UNRATED'
  const status = text(finding?.status).toUpperCase() || 'OPEN'
  const title = text(finding?.title) || 'Finding'
  baseline.push(`### [${status}] ${severity} — ${title} · ${text(finding?.id)}`)
  baseline.push('')
  if (text(finding?.detail)) baseline.push(text(finding.detail))
  baseline.push('')
  baseline.push(`- Evidence: ${evidence(finding?.evidence_paths)}`)
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

baseline.push('## Active findings')
baseline.push('')
const active = baselineState.findings.filter((f) => !['resolved', 'stale'].includes(f.status))
if (active.length) for (const finding of active) renderFinding(baseline, finding)
else baseline.push('No active engineering findings are currently recorded.')

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
  always_on_rule_count: alwaysOnRules.length,
  module_count: modules.length
}))
