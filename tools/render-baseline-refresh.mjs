#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { severityOf, resolveSeverity, severityRank, severityLabel, verdictOf, CARRY, UNRATED } from './severity.mjs'

function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid argument near ${key ?? '<end>'}`)
    out[key.slice(2)] = value
  }
  return out
}
function req(args, name) { const v=args[name]; if(!v) throw new Error(`Missing --${name}`); return v }
function text(v) { return typeof v === 'string' ? v.trim() : '' }
function list(v,max=20) { return Array.isArray(v) ? v.map(text).filter(Boolean).slice(0,max) : [] }
function safePath(v) {
  const s=text(v).replaceAll('\\','/')
  if(!s || s.startsWith('/') || s.startsWith('~') || s.includes('../') || /^[A-Za-z]:\//.test(s)) return ''
  return s
}
function evidence(paths) {
  const p=list(paths,12).map(safePath).filter(Boolean)
  return p.length ? p.map(x=>`\`${x.replaceAll('`','\\`')}\``).join(', ') : 'No specific path recorded'
}
function bullet(v) { return `- ${text(v).replace(/\s+/g,' ')}` }

// Compare titles on their words, so a reworded finding that differs only in punctuation or
// casing is recognized as the one already recorded rather than appended beside it.
function titleKey(v) { return text(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() }

// The baseline is loaded as context for every future task, so unbounded growth degrades the
// thing it exists to improve. Retain the highest-severity findings and drop the tail,
// oldest-first within a severity so the visible set stays stable between refreshes.
const MAX_ACTIVE_FINDINGS = 20
const MAX_ARCHIVED_FINDINGS = 15
// Carried findings get their own budget rather than competing for the 20. They are the cheapest
// thing in the baseline to lose — a full reanalysis finds them again — and letting them consume
// slots would reproduce exactly the crowding the verdict exists to end.
const MAX_CARRIED_FINDINGS = 10
// `accepted` is archived, not active: the risk is real and the project decided to carry it, so it
// stays on the record without nagging from the section that asks for action every session.
// `invalid` is archived for a different reason — the claim was never true — and is kept rather
// than deleted so the title-key dedup below stops a later run from reporting it again.
const ARCHIVED_STATUSES = ['resolved','stale','accepted','invalid']
const findingRank = f => severityRank(resolveSeverity(f).severity)
const isArchived = f => ARCHIVED_STATUSES.includes(text(f.status))
// A finding the harness decided is not worth the fix is neither active work nor archived history.
// `accepted` remains the human counterpart: the harness computes `carry` from harm and cost, a
// person sets `accepted` when the project has decided in writing to live with something.
const isCarried = f => !isArchived(f) && verdictOf(f) === CARRY
const isActive = f => !isArchived(f) && !isCarried(f)

function capFindings(findings, max) {
  if (findings.length <= max) return { kept: findings, dropped: 0 }
  const keep = new Set(findings
    .map((f, index) => ({ f, index }))
    .sort((a, b) => findingRank(a.f) - findingRank(b.f) || a.index - b.index)
    .slice(0, max)
    .map(x => x.index))
  return { kept: findings.filter((_, i) => keep.has(i)), dropped: findings.length - max }
}

const args=parseArgs(process.argv)
const currentPath=req(args,'current')
const responsePath=req(args,'response')
const outDir=req(args,'out')
const current=JSON.parse(fs.readFileSync(currentPath,'utf8'))
const payload=JSON.parse(fs.readFileSync(responsePath,'utf8'))
const refresh=payload?.structured_output
if(!refresh || typeof refresh !== 'object') throw new Error('Claude response does not contain structured_output')

const before=JSON.parse(JSON.stringify(current))
current.version = 2
current.findings = Array.isArray(current.findings) ? current.findings : []
const byId=new Map(current.findings.map(f=>[text(f.id),f]))
let updated=0, resolved=0, changedCount=0, stale=0, added=0

for(const review of Array.isArray(refresh.finding_reviews) ? refresh.finding_reviews : []) {
  const id=text(review?.finding_id)
  const target=byId.get(id)
  if(!target) continue
  // A review that reports no axes is revisiting a finding without re-measuring it, so the axes it
  // already carried stand. Overwriting them with empty strings would leave the finding showing a
  // real level beside "not measured", which is the kind of half-degraded artifact that reads as
  // grounded.
  const axes={
    impact:text(review?.impact)||text(target.impact),
    trigger:text(review?.trigger)||text(target.trigger),
    blast_radius:text(review?.blast_radius)||text(target.blast_radius),
    fix_cost:text(review?.fix_cost)||text(target.fix_cost),
  }
  const rated=severityOf(axes)
  const next={
    ...target,
    status:text(review?.status)||target.status||'open',
    ...axes,
    // Derived, never taken from the model. An unmeasurable review leaves the finding on the rating
    // it already had rather than silently dropping to the mildest level.
    severity:rated!==UNRATED ? rated : (text(target.severity)||UNRATED),
    title:text(review?.title)||target.title||'Finding',
    detail:text(review?.detail)||target.detail||'',
    // A review restates a finding; it is not obliged to re-derive the scenario. Falling back to
    // the stored example keeps a routine 'still open' from erasing the one thing that made the
    // finding judgeable, the same way detail already falls back.
    example:text(review?.example)||target.example||'',
    evidence_paths:list(review?.evidence_paths,10).map(safePath).filter(Boolean),
    recommendation:text(review?.recommendation),
    resolution:text(review?.resolution),
  }
  const old=JSON.stringify(target)
  Object.assign(target,next)
  if(JSON.stringify(target)!==old) {
    updated++
    if(target.status==='resolved') resolved++
    if(target.status==='changed') changedCount++
    if(target.status==='stale') stale++
  }
}

// Findings keep stable F### identity. A finding dropped by the retention cap must never
// hand its number to a different finding later, so allocation runs off a persisted counter
// rather than off the current maximum.
const maxExistingId=current.findings.reduce((m,f)=>Math.max(m, Number(/^F(\d+)$/.exec(text(f.id))?.[1]||0)),0)
let nextId=Math.max(Number(current.next_finding_id)||0, maxExistingId+1)
const titleKeys=new Set(current.findings.map(f=>titleKey(f.title)).filter(Boolean))
for(const nf of Array.isArray(refresh.new_findings) ? refresh.new_findings : []) {
  const title=text(nf?.title)
  const key=titleKey(title)
  if(!title || titleKeys.has(key)) continue
  const finding={
    id:`F${String(nextId).padStart(3,'0')}`,
    status:'new',
    impact:text(nf?.impact),
    trigger:text(nf?.trigger),
    blast_radius:text(nf?.blast_radius),
    fix_cost:text(nf?.fix_cost),
    severity:severityOf(nf),
    title,
    detail:text(nf?.detail),
    example:text(nf?.example),
    evidence_paths:list(nf?.evidence_paths,10).map(safePath).filter(Boolean),
    recommendation:text(nf?.recommendation),
    resolution:'',
  }
  current.findings.push(finding)
  titleKeys.add(key)
  nextId++
  added++
}
current.next_finding_id=nextId

if (Boolean(refresh.full_reanalysis_recommended)) {
  current.full_reanalysis_recommended = true
  current.full_reanalysis_reason = text(refresh.full_reanalysis_reason) || text(current.full_reanalysis_reason)
} else {
  current.full_reanalysis_recommended = Boolean(current.full_reanalysis_recommended)
  current.full_reanalysis_reason = text(current.full_reanalysis_reason)
}

const activeCap=capFindings(current.findings.filter(isActive), MAX_ACTIVE_FINDINGS)
const carriedCap=capFindings(current.findings.filter(isCarried), MAX_CARRIED_FINDINGS)
const archivedCap=capFindings(current.findings.filter(isArchived), MAX_ARCHIVED_FINDINGS)
const pruned=activeCap.dropped+carriedCap.dropped+archivedCap.dropped
if(pruned) {
  const retained=new Set([...activeCap.kept, ...carriedCap.kept, ...archivedCap.kept])
  current.findings=current.findings.filter(f=>retained.has(f))
}

function semanticState(x) {
  return {
    version:x.version,
    system_summary:x.system_summary,
    architecture_summary:x.architecture_summary,
    business_invariants:x.business_invariants,
    confidence_notes:x.confidence_notes,
    findings:x.findings,
    full_reanalysis_recommended:Boolean(x.full_reanalysis_recommended),
    full_reanalysis_reason:text(x.full_reanalysis_reason),
  }
}
const hasChanged=JSON.stringify(semanticState(before))!==JSON.stringify(semanticState(current))

function renderFinding(lines,f) {
  const status=text(f.status).toUpperCase()||'OPEN'
  const {severity,legacy}=resolveSeverity(f)
  lines.push(`### [${status}] ${severityLabel(severity)} — ${text(f.title)||'Finding'} · ${text(f.id)}`)
  lines.push('')
  if(text(f.detail)) lines.push(text(f.detail))
  lines.push('')
  lines.push(text(f.example) ? `**Example.** ${text(f.example).replace(/\s+/g,' ')}` : '**Example.** Not provided.')
  lines.push('')
  lines.push(`- Evidence: ${evidence(f.evidence_paths)}`)
  // Show the axes the rating came from, so a reader can argue with the inputs rather than the verdict.
  if(text(f.impact)&&text(f.trigger)) lines.push(`- Rated: ${text(f.impact)} × ${text(f.trigger)} × ${text(f.blast_radius)||'component'}`)
  else if(legacy) lines.push('- Rated: carried over from a baseline written before severity axes existed; not re-measured')
  else lines.push('- Rated: not measured')
  // The other half of the carried verdict, shown so a reader can argue with the input.
  if(text(f.fix_cost)) lines.push(`- Fix cost: ${text(f.fix_cost)}`)
  if(text(f.recommendation)) lines.push(`- Incremental recommendation: ${text(f.recommendation).replace(/\s+/g,' ')}`)
  if(text(f.resolution)) lines.push(`- Resolution note: ${text(f.resolution).replace(/\s+/g,' ')}`)
  lines.push('')
}

fs.mkdirSync(outDir,{recursive:true})
const lines=[]
lines.push('<!-- generated-by: claude-engineering-harness -->')
lines.push('# Engineering Baseline')
lines.push('')
lines.push('Living engineering baseline generated from repository evidence. Findings are advisory and must always be revalidated against current source and tests before action. The harness refreshes affected findings automatically after verified Claude Code changes.')
lines.push('')
lines.push('## System','',text(current.system_summary),'','## Architecture','',text(current.architecture_summary),'')
if(current.full_reanalysis_recommended) {
  lines.push('> **Full harness reanalysis recommended.** ' + (text(current.full_reanalysis_reason)||'Recent changes appear to alter architecture or project-wide rules.'),'')
}
const active=current.findings.filter(isActive)
lines.push('## Active findings','')
if(active.length) {
  active.sort((a,b)=>findingRank(a)-findingRank(b))
  for(const f of active) renderFinding(lines,f)
} else lines.push('No active engineering findings are currently recorded.','')
const carried=current.findings.filter(isCarried)
if(carried.length) {
  carried.sort((a,b)=>findingRank(a)-findingRank(b))
  lines.push('## Carried findings — not worth the fix','')
  // Counted out loud rather than silently omitted: absence is not data, and a reader has to be
  // able to see that these were measured and set aside, not that nothing was found.
  lines.push(`${carried.length} finding(s) are real but cost more to remove than the harm they carry. They are recorded, not scheduled. Revisit one when its area is being changed anyway, or when new evidence raises its rating.`,'')
  for(const f of carried) renderFinding(lines,f)
}
const resolvedFindings=current.findings.filter(f=>text(f.status)==='resolved')
if(resolvedFindings.length) { lines.push('## Resolved findings',''); for(const f of resolvedFindings) renderFinding(lines,f) }
const staleFindings=current.findings.filter(f=>text(f.status)==='stale')
if(staleFindings.length) { lines.push('## Stale findings',''); for(const f of staleFindings) renderFinding(lines,f) }
const acceptedFindings=current.findings.filter(f=>text(f.status)==='accepted')
if(acceptedFindings.length) {
  lines.push('## Accepted risks','')
  lines.push('Real risks the project has decided to carry. The rating states the risk; the status states the decision.','')
  for(const f of acceptedFindings) renderFinding(lines,f)
}
const invalidFindings=current.findings.filter(f=>text(f.status)==='invalid')
if(invalidFindings.length) {
  lines.push('## Withdrawn findings','')
  lines.push('Reported by an earlier analysis and since shown not to be true of this repository. They are kept, not deleted, so a later analysis does not report them again — read the resolution before reopening one.','')
  for(const f of invalidFindings) renderFinding(lines,f)
}
const invariants=Array.isArray(current.business_invariants)?current.business_invariants:[]
if(invariants.length) {
  lines.push('## Evidenced business invariants','')
  for(const i of invariants) { lines.push(`${bullet(i.rule)} [${text(i.id)}]`); lines.push(`  - Evidence: ${evidence(i.evidence_paths)}`) }
  lines.push('')
}
const notes=list(current.confidence_notes,20)
if(notes.length) { lines.push('## Analysis limitations',''); for(const n of notes) lines.push(bullet(n)); lines.push('') }
lines.push('A full architecture/rule regeneration still comes from `~/.claude/harness-tools/init-project.sh`; routine finding freshness is automatic on Claude Code Stop after successful verification.','')

fs.writeFileSync(path.join(outDir,'engineering-baseline.md'),lines.join('\n'))
fs.writeFileSync(path.join(outDir,'engineering-baseline.json'),JSON.stringify(current,null,2)+'\n')
console.log(JSON.stringify({changed:hasChanged,updated,resolved,changed_findings:changedCount,stale,added,pruned,carried:current.findings.filter(isCarried).length,full_reanalysis_recommended:current.full_reanalysis_recommended,summary:text(refresh.summary)}))
