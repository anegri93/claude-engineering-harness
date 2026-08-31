// Severity is computed here, never asked of the model.
//
// It used to be a free judgement: the schemas offered `critical|high|medium|low` and nothing —
// not the prompt, not the schema, not the renderers — said when to use which. So the same finding
// drifted between runs, two projects' `medium` meant different things, and the retention cap in
// render-baseline-refresh.mjs dropped findings by that drift. A rating with no written scale reads
// exactly like a calibrated one, which is the failure this repository chases everywhere else.
//
// The model now reports three facts it can ground in the code, and this table turns them into the
// rating. The judgement that remains is smaller and checkable: "is the harm already occurring or
// hypothetical" is arguable against evidence in a way "is this medium or low" never was.
//
// `trigger` is about the HARM, not the code path. An unpinned `npm install <pkg>@latest` runs on
// every initialization, but the harm needs a bad version to be published first: that is
// `hypothetical`, not `already_occurring`. Getting this backwards inflates every finding.

function str(v) { return typeof v === 'string' ? v.trim() : '' }

// Ordered worst first. Index order is load-bearing: the blast-radius modifier moves along it.
export const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low']
export const IMPACT = ['data_loss', 'security', 'incorrect_result', 'maintenance', 'cosmetic']
export const TRIGGER = ['already_occurring', 'normal_use', 'specific_conditions', 'hypothetical']
export const BLAST_RADIUS = ['system_wide', 'component', 'local']

// Rendered in place of a level when the axes were not reported. Absence is not data: a finding
// nobody measured must not read as a mild one.
export const UNRATED = 'unrated'

// `data_loss` bottoms out at medium rather than low: the consequence is unrecoverable, so even a
// path nobody has walked yet is worth more than a maintenance nit.
const TABLE = {
  data_loss:        { already_occurring: 'critical', normal_use: 'critical', specific_conditions: 'medium', hypothetical: 'medium' },
  security:         { already_occurring: 'critical', normal_use: 'high',     specific_conditions: 'high',   hypothetical: 'medium' },
  incorrect_result: { already_occurring: 'high',     normal_use: 'high',     specific_conditions: 'medium', hypothetical: 'low' },
  maintenance:      { already_occurring: 'medium',   normal_use: 'medium',   specific_conditions: 'low',    hypothetical: 'low' },
  cosmetic:         { already_occurring: 'low',      normal_use: 'low',      specific_conditions: 'low',    hypothetical: 'low' },
}

// Negative moves toward `critical`, because SEVERITY_LEVELS is ordered worst first.
const SHIFT = { system_wide: -1, component: 0, local: 1 }

export function severityOf(finding) {
  const base = TABLE[str(finding?.impact)]?.[str(finding?.trigger)]
  if (!base) return UNRATED

  const shift = SHIFT[str(finding?.blast_radius)] ?? 0
  const moved = Math.min(Math.max(SEVERITY_LEVELS.indexOf(base) + shift, 0), SEVERITY_LEVELS.length - 1)
  const level = SEVERITY_LEVELS[moved]

  // The modifier may raise a finding but never invent a critical. This harness is system-wide by
  // nature — it installs into a home directory and fires in every repository — so without this
  // guard every latent weakness in it would climb to the top level and `critical` would stop
  // carrying information. Only the base table may produce one.
  if (level === 'critical' && base !== 'critical') return 'high'
  return level
}

// A baseline written before the axes existed carries a severity string and no axes. It keeps the
// rating it was given, flagged as legacy, until a refresh reviews that finding and supplies them.
// Forcing every stored finding to `unrated` on upgrade would discard real information across every
// project already initialized, to fix a labelling problem.
export function resolveSeverity(finding) {
  const computed = severityOf(finding)
  if (computed !== UNRATED) return { severity: computed, legacy: false }

  const stored = str(finding?.severity)
  if (SEVERITY_LEVELS.includes(stored)) return { severity: stored, legacy: true }
  return { severity: UNRATED, legacy: false }
}

// Unrated sorts after every rated finding rather than among the mild ones, so an unmeasured
// finding is never quietly buried in the tail of the `low` group.
export function severityRank(severity) {
  const index = SEVERITY_LEVELS.indexOf(str(severity))
  return index === -1 ? SEVERITY_LEVELS.length : index
}

export function severityLabel(severity) {
  const s = str(severity)
  return SEVERITY_LEVELS.includes(s) ? s.toUpperCase() : 'NOT MEASURED'
}

// ---------------------------------------------------------------------------
// Worth acting on
//
// The three axes above measure harm only. Nothing in them asks what a fix costs, so a real but
// trivial weakness that would take a cross-cutting refactor to remove printed exactly like a
// one-line bug, and the reader had no way to tell them apart. Every run then filled its ten slots
// with things nobody was ever going to do, and the ones that mattered lost their signal.
//
// `fix_cost` is the fourth reported fact and the harness computes the verdict from it, for the
// same reason the rating is computed: "how many call sites does the fix touch" is arguable against
// `recommendation` and `evidence_paths` in a way "is this worth it" never was.
//
// Harm still wins. A `critical` or `high` finding is worth acting on at any cost — the verdict
// only ever demotes the tail.
export const FIX_COST = ['single_site', 'contained', 'invasive']
export const ACT = 'act'
export const CARRY = 'carry'

// Severity → the fix costs at which the finding stops being worth acting on.
const CARRY_AT = {
  medium: ['invasive'],
  low: ['contained', 'invasive'],
}

// Absence is not data here either: a finding that reported no fix cost, or one carried over from a
// baseline written before this axis existed, stays actionable. Demoting the unmeasured would hide
// findings behind a fact nobody supplied.
export function verdictOf(finding) {
  const cost = str(finding?.fix_cost)
  if (!FIX_COST.includes(cost)) return ACT
  const { severity } = resolveSeverity(finding)
  return CARRY_AT[severity]?.includes(cost) ? CARRY : ACT
}
