#!/usr/bin/env node
// Live progress for a scripted `claude --output-format stream-json` run.
//
// Why this exists: the analysis call is a single high-effort read-only pass that can run for
// several minutes, and with `--output-format json` the CLI writes nothing at all until it is
// done. That left the user staring at a bare cursor with no way to tell a working run from a
// hung one, and an init that looks hung is an init that gets killed halfway through.
//
// This reads the NDJSON event stream on stdin, repaints one progress line on stderr, mirrors the
// raw stream to --raw-out for failure diagnostics, and writes the final `result` event to
// --result-out in exactly the shape `--output-format json` would have produced, so every
// renderer downstream is unchanged.
//
// stdout is deliberately left untouched: the caller consumes it, and progress is a diagnostic.

import fs from 'node:fs'

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(name)
  return i === -1 ? '' : (args[i + 1] || '')
}

const resultOut = flag('--result-out')
const rawOut = flag('--raw-out')
const label = flag('--label') || 'analysis'
const turnBudget = Number.parseInt(flag('--turn-budget'), 10)

if (!resultOut) {
  process.stderr.write('stream-progress: --result-out <file> is required\n')
  process.exit(2)
}

const rawStream = rawOut ? fs.createWriteStream(rawOut, { flags: 'a' }) : null

// Everything rendered below can carry model-authored text (tool names, file paths, patterns). It
// goes straight to a terminal, so control characters and escape sequences are stripped before
// they can move the cursor, repaint the screen, or hide what the run is really doing.
function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const state = {
  started: Date.now(),
  cwd: '',
  turns: new Set(),
  tools: 0,
  thinking: 0,
  activity: 'starting',
  unparsed: 0,
  result: null,
}

function shortenPath(value) {
  let shown = value
  if (state.cwd && shown.startsWith(state.cwd + '/')) shown = shown.slice(state.cwd.length + 1)
  if (shown.length <= 48) return shown
  return '…' + shown.slice(-47)
}

function activityFor(block) {
  const name = clean(block.name, 24) || 'tool'
  const input = block.input && typeof block.input === 'object' ? block.input : {}
  const detail = input.file_path || input.path || input.pattern || input.glob || input.query || ''
  const shown = detail ? shortenPath(clean(detail, 120)) : ''
  return shown ? name + ' ' + shown : name
}

function elapsed() {
  const total = Math.floor((Date.now() - state.started) / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
}

function progressFields() {
  const fields = [elapsed(), label]
  const turns = state.turns.size
  if (turns > 0) {
    fields.push(Number.isFinite(turnBudget) ? `turn ${turns}/${turnBudget}` : `turn ${turns}`)
  }
  fields.push(state.activity)
  if (state.tools > 0) fields.push(`${state.tools} tool ${state.tools === 1 ? 'call' : 'calls'}`)
  if (state.thinking > 0) fields.push(`~${Math.round(state.thinking / 1000)}k thinking`)
  return fields
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const CLEAR_LINE = '\r\u001b[2K'
// HARNESS_PROGRESS_TTY is a test seam: the repainting branch is the one a real user sees, and
// a spawned test process never has a TTY on stderr, so without it that branch — including the
// stripping of model-authored text before it reaches a live terminal — is untestable.
const isTty = process.env.HARNESS_PROGRESS_TTY === '1' || process.stderr.isTTY === true
let frame = 0
let lastPrint = 0
let lastActivity = ''
let painted = false

function clearLine() {
  if (isTty && painted) {
    process.stderr.write(CLEAR_LINE)
    painted = false
  }
}

function paint() {
  const line = progressFields().join(' · ')
  if (isTty) {
    const width = (process.stderr.columns || 100) - 3
    process.stderr.write(CLEAR_LINE + FRAMES[frame++ % FRAMES.length] + ' ' + line.slice(0, width))
    painted = true
    return
  }
  // Without a TTY (a hook, a CI log) a repainting line becomes thousands of lines, so print only
  // when the activity actually changed, and never more than once every five seconds. The
  // one-minute floor keeps a long silent stretch of thinking distinguishable from a hang.
  const now = Date.now()
  if (state.activity !== lastActivity && now - lastPrint >= 5000) {
    lastActivity = state.activity
    lastPrint = now
    process.stderr.write('  ' + line + '\n')
  } else if (now - lastPrint >= 60000) {
    lastPrint = now
    process.stderr.write('  ' + line + '\n')
  }
}

function handle(event) {
  switch (event.type) {
    case 'system':
      if (event.subtype === 'init') {
        state.cwd = typeof event.cwd === 'string' ? event.cwd : ''
        state.activity = 'reading the repository'
      } else if (event.subtype === 'thinking_tokens') {
        const delta = Number(event.estimated_tokens_delta)
        if (Number.isFinite(delta) && delta > 0) state.thinking += delta
        state.activity = 'thinking'
      }
      break
    case 'assistant': {
      const message = event.message && typeof event.message === 'object' ? event.message : {}
      // Turns are counted by message id: the same assistant message arrives as several events
      // (thinking, then each tool_use), and counting events would inflate the number.
      if (message.id) state.turns.add(message.id)
      const blocks = Array.isArray(message.content) ? message.content : []
      for (const block of blocks) {
        if (block && block.type === 'tool_use') {
          state.tools += 1
          state.activity = activityFor(block)
        }
      }
      break
    }
    case 'result':
      state.result = event
      break
    default:
      break
  }
}

const ticker = setInterval(paint, isTty ? 250 : 5000)
process.on('exit', clearLine)

function consume(line) {
  if (!line.trim()) return
  try {
    handle(JSON.parse(line))
  } catch {
    state.unparsed += 1
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  if (rawStream) rawStream.write(chunk)
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index !== -1) {
    consume(buffer.slice(0, index))
    buffer = buffer.slice(index + 1)
    index = buffer.indexOf('\n')
  }
  paint()
})

process.stdin.on('end', () => {
  consume(buffer)
  buffer = ''
  clearInterval(ticker)
  clearLine()

  if (!state.result) {
    process.stderr.write(`  ${label}: the stream ended without a result event after ${elapsed()}.\n`)
    if (rawStream) rawStream.end()
    process.exitCode = 1
    return
  }

  try {
    fs.writeFileSync(resultOut, JSON.stringify(state.result) + '\n')
  } catch (error) {
    process.stderr.write(`  ${label}: could not write ${resultOut}: ${clean(error && error.message, 200)}\n`)
    if (rawStream) rawStream.end()
    process.exitCode = 1
    return
  }

  const fields = [`${label} finished in ${elapsed()}`]
  if (state.turns.size > 0) fields.push(`${state.turns.size} turns`)
  if (state.tools > 0) fields.push(`${state.tools} tool calls`)
  if (state.thinking > 0) fields.push(`~${Math.round(state.thinking / 1000)}k thinking tokens`)
  // Reported rather than swallowed: lines this tool could not parse mean the progress it showed
  // described less than what actually ran.
  if (state.unparsed > 0) fields.push(`${state.unparsed} unparsed stream lines`)
  process.stderr.write('  ' + fields.join(' · ') + '\n')

  if (rawStream) rawStream.end()
})
