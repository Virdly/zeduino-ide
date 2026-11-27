/**
 * Lightweight C/C++/Arduino formatter (indentation only).
 *
 * It re-indents the code without changing tokens: braces, parentheses and
 * continuation lines define the indentation level. Preprocessor lines stay at
 * column 0, `case`/`default` labels are handled like clang-format does, and
 * blank lines / trailing whitespace are cleaned up.
 *
 * There is no external dependency (no clang-format binary required).
 */

import type { EditorView } from '@codemirror/view'
import type { ChangeSpec, EditorState } from '@codemirror/state'

const CONTINUATION_END = /[,(+\-*/%=<>!&|?:\\]/

interface ScanState {
  depth: number
  paren: number
  inBlockComment: boolean
  continuation: boolean
}

interface LineScan {
  depth: number
  paren: number
  inBlockComment: boolean
  continuation: boolean
}

/** Scans one line, ignoring strings, chars, comments and preprocessor content. */
function scanLine(line: string, state: ScanState): LineScan {
  let depth = state.depth
  let paren = state.paren
  let inBlockComment = state.inBlockComment
  let lastCode = ''
  let i = 0

  while (i < line.length) {
    const char = line[i]

    if (inBlockComment) {
      const end = line.indexOf('*/', i)
      if (end < 0) {
        i = line.length
        break
      }
      inBlockComment = false
      i = end + 2
      continue
    }

    if (char === '/' && line[i + 1] === '/') break
    if (char === '/' && line[i + 1] === '*') {
      inBlockComment = true
      i += 2
      continue
    }

    if (char === '"' || char === "'") {
      const quote = char
      i++
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2
          continue
        }
        if (line[i] === quote) {
          i++
          break
        }
        i++
      }
      lastCode = 'x'
      continue
    }

    if (char === '{') depth++
    else if (char === '}') depth = Math.max(0, depth - 1)
    else if (char === '(') paren++
    else if (char === ')') paren = Math.max(0, paren - 1)

    if (!/\s/.test(char)) lastCode = char
    i++
  }

  const continuation = !inBlockComment && lastCode !== '' && CONTINUATION_END.test(lastCode)
  return { depth, paren, inBlockComment, continuation }
}

/** Counts closing braces/parens at the very beginning of a line (`} else {`). */
function leadingClosers(line: string): { braces: number; parens: number } {
  let braces = 0
  let parens = 0
  let i = 0
  while (i < line.length) {
    const char = line[i]
    if (/\s/.test(char)) {
      i++
      continue
    }
    if (char === '}') {
      braces++
      i++
      continue
    }
    if (char === ')') {
      parens++
      i++
      continue
    }
    if (char === ']') {
      i++
      continue
    }
    break
  }
  return { braces, parens }
}

const CASE_LABEL = /^(case\b[\s\S]*|default\s*[^:]*):\s*(?:\/\/.*)?$/
const PREPROCESSOR = /^#\s*\w/

/** Re-indents C/C++/Arduino source code. Tokens and line breaks are kept. */
export function formatCCode(source: string, tabSize: number): string {
  const unit = ' '.repeat(Math.max(1, Math.floor(tabSize) || 2))
  const hasFinalNewline = source.endsWith('\n')
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  if (hasFinalNewline) lines.pop() // re-added below

  const output: string[] = []
  const state: ScanState = { depth: 0, paren: 0, inBlockComment: false, continuation: false }
  let caseDepth: number | null = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    const trimmed = line.trim()

    if (trimmed === '') {
      output.push('')
      continue
    }

    if (state.inBlockComment) {
      const indent = unit.repeat(Math.max(0, state.depth))
      output.push(indent + trimmed)
      const scan = scanLine(trimmed, state)
      state.depth = scan.depth
      state.paren = scan.paren
      state.inBlockComment = scan.inBlockComment
      state.continuation = scan.continuation
      continue
    }

    // Preprocessor directives always start at column 0.
    if (PREPROCESSOR.test(trimmed)) {
      output.push(trimmed)
      state.continuation = /\\$/.test(trimmed)
      continue
    }

    const isCase = CASE_LABEL.test(trimmed)
    const closers = leadingClosers(trimmed)
    const baseDepth = Math.max(0, state.depth - closers.braces)
    const startsWithClosingParen = /^[)\]}]/.test(trimmed)

    let extra = 0
    if (state.paren > closers.parens && !startsWithClosingParen) extra = 1
    if (state.continuation && !startsWithClosingParen) extra = Math.max(extra, 1)
    if (caseDepth !== null && baseDepth >= caseDepth && !isCase) extra = Math.max(extra, 1)

    output.push(unit.repeat(baseDepth + extra) + trimmed)

    const scan = scanLine(trimmed, state)
    state.depth = scan.depth
    state.paren = scan.paren
    state.inBlockComment = scan.inBlockComment
    state.continuation = isCase ? false : scan.continuation

    if (isCase) {
      caseDepth = state.depth
    } else if (caseDepth !== null && state.depth < caseDepth) {
      caseDepth = null
    }
  }

  const result = output.join('\n')
  return hasFinalNewline ? `${result}\n` : result
}

/**
 * Computes the document changes for a format operation: the selection (if it
 * is not empty) or the whole document (plain cursor).
 */
export function computeFormatChanges(state: EditorState, tabSize: number): ChangeSpec[] {
  const selected = state.selection.ranges.filter((range) => !range.empty)
  const ranges: { from: number; to: number }[] = selected.length
    ? selected.map((range) => ({ from: range.from, to: range.to }))
    : [{ from: 0, to: state.doc.length }]

  const changes: ChangeSpec[] = []
  for (const range of ranges) {
    const fromLine = state.doc.lineAt(range.from)
    const toLine = state.doc.lineAt(range.to)
    const from = fromLine.from
    const to = toLine.to
    const original = state.sliceDoc(from, to)
    const formatted = formatCCode(original, tabSize)
    if (formatted !== original) changes.push({ from, to, insert: formatted })
  }
  return changes
}

/** Formats the selection (or the whole document when nothing is selected). */
export function formatEditorSelection(view: EditorView, tabSize: number): boolean {
  const { state } = view
  if (state.readOnly) return false

  const changes = computeFormatChanges(state, tabSize)
  if (!changes.length) return true

  view.dispatch({
    changes,
    userEvent: 'format',
    scrollIntoView: true,
  })
  return true
}
