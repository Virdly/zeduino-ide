/**
 * Workspace symbol index for the editor's autocomplete.
 *
 * The index is built from `window.api.project.index()` (all readable project
 * files) with very cheap regex parsing. Building is time-sliced: expensive
 * work is interleaved with idle callbacks so typing never waits for it. The
 * completion source itself always reads already-cached arrays.
 */

import type { ProjectIndex } from '../../shared/api'

export type IndexedSymbolType = 'function' | 'variable' | 'class' | 'keyword'

export interface IndexedSymbol {
  /** Identifier inserted into the document. */
  label: string
  /** Drives the completion icon. */
  type: IndexedSymbolType
  /** Short signature / declaration preview. */
  detail: string
  /** Project-relative path of the file that defines the symbol. */
  file?: string
}

const CODE_EXTENSIONS = new Set([
  '.ino',
  '.pde',
  '.h',
  '.hpp',
  '.hh',
  '.hxx',
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
])

const MAX_PARSE_CHARS = 300_000
const MAX_SYMBOLS_PER_FILE = 160
const MAX_INDEX_SYMBOLS = 4000
const DOCUMENT_CACHE_LIMIT = 12

const EMPTY: readonly IndexedSymbol[] = []

let workspaceSymbols: readonly IndexedSymbol[] = EMPTY
let indexPromise: Promise<void> | null = null
let rebuildRequested = false
const listeners = new Set<() => void>()
const documentSymbols = new Map<string, readonly IndexedSymbol[]>()

const RESERVED = new Set([
  'alignas',
  'alignof',
  'auto',
  'bool',
  'break',
  'case',
  'catch',
  'char',
  'class',
  'const',
  'constexpr',
  'continue',
  'decltype',
  'default',
  'delete',
  'do',
  'double',
  'else',
  'enum',
  'explicit',
  'extern',
  'false',
  'float',
  'for',
  'friend',
  'goto',
  'if',
  'inline',
  'int',
  'long',
  'mutable',
  'namespace',
  'new',
  'noexcept',
  'nullptr',
  'operator',
  'private',
  'protected',
  'public',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'template',
  'this',
  'throw',
  'true',
  'try',
  'typedef',
  'typename',
  'union',
  'unsigned',
  'using',
  'virtual',
  'void',
  'volatile',
  'while',
])

const FUNCTION_RE =
  /(^|\n)[ \t]*(?:template[ \t]*<[^>\n]*>[ \t]*)?([A-Za-z_][\w:<>,*& \t]*?)[ \t]+([A-Za-z_]\w*)[ \t]*\(([^;{}]*)\)[ \t]*(?:const[ \t]*)?(?:noexcept[ \t]*)?(?::[^{\n]*)?\{/g

const METHOD_RE =
  /(^|\n)[ \t]*(?:[A-Za-z_][\w:<>,*& \t]*?[ \t]+)?(?:[A-Za-z_]\w*[ \t]*::[ \t]*)+([A-Za-z_]\w*)[ \t]*\(([^;{}]*)\)[ \t]*(?:const[ \t]*)?(?::[^{\n]*)?\{/g

const TYPE_RE = /(^|\n)[ \t]*(?:typedef[ \t]+)?(class|struct|enum(?:[ \t]+class)?)[ \t]+([A-Za-z_]\w*)/g

const TYPEDEF_RE = /(^|\n)[ \t]*typedef[^\n;]*?\b([A-Za-z_]\w*)[ \t]*;/g

const DEFINE_RE = /(^|\n)[ \t]*#define[ \t]+([A-Za-z_]\w*)([^\n]*)/g

const GLOBAL_VAR_RE =
  /^(?:(?:const|static|volatile|extern|mutable|constexpr)[ \t]+)*(?:(?:struct|class|enum|union)[ \t]+)?(?:(?:unsigned|signed)[ \t]+)?(?:byte|bool|boolean|int|long|short|float|double|char|word|String|size_t|auto|unsigned|signed|u?int(?:8|16|32|64)_t|[A-Z][A-Za-z0-9_]*)[ \t]*([*&]?)[ \t]*([A-Za-z_]\w*)[ \t]*(?:\[[^\]]*\])?[ \t]*(?:=[^;]*)?;/

/** Removes comments and blanks out string literals, keeping line structure. */
function stripComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n'
        i++
      }
      i += 2
      out += ' '
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      out += ch
      i++
      while (i < text.length) {
        const c = text[i]
        if (c === '\\') {
          out += '  '
          i += 2
          continue
        }
        if (c === quote || c === '\n') break
        out += ' '
        i++
      }
      if (text[i] === quote) {
        out += quote
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

function clip(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function isIndexableFile(path: string, ext: string): boolean {
  let suffix = ext.toLowerCase()
  if (!suffix) {
    const dot = path.lastIndexOf('.')
    suffix = dot >= 0 ? path.slice(dot).toLowerCase() : ''
  }
  return CODE_EXTENSIONS.has(suffix)
}

/**
 * Extracts symbols from a single source file. Exported for reuse/tests; the
 * function is synchronous and cheap (input is capped).
 */
export function parseSymbols(path: string, text: string): IndexedSymbol[] {
  const source = text.length > MAX_PARSE_CHARS ? text.slice(0, MAX_PARSE_CHARS) : text
  const clean = stripComments(source)
  const rawLines = source.split('\n')
  const cleanLines = clean.split('\n')
  const symbols: IndexedSymbol[] = []
  const seen = new Set<string>()

  const cleanLineAt = (lineStart: number): string => {
    const lineEnd = clean.indexOf('\n', lineStart)
    return clean.slice(lineStart, lineEnd < 0 ? clean.length : lineEnd).trim()
  }

  const add = (label: string, type: IndexedSymbolType, detail: string) => {
    if (!label || RESERVED.has(label) || seen.has(label) || symbols.length >= MAX_SYMBOLS_PER_FILE) return
    seen.add(label)
    symbols.push({ label, type, detail: clip(detail), file: path })
  }

  /* ------------------------------------------------------------------ #define */
  DEFINE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = DEFINE_RE.exec(clean))) {
    const lineStart = match.index + match[1].length
    add(match[2], 'variable', cleanLineAt(lineStart) || `#define ${match[2]}`)
  }

  /* ------------------------------------------------------- classes and enums */
  TYPE_RE.lastIndex = 0
  while ((match = TYPE_RE.exec(clean))) {
    add(match[3], 'class', `${match[2]} ${match[3]}`)
  }

  TYPEDEF_RE.lastIndex = 0
  while ((match = TYPEDEF_RE.exec(clean))) {
    const lineStart = match.index + match[1].length
    add(match[2], 'class', cleanLineAt(lineStart) || `typedef ${match[2]};`)
  }

  /* --------------------------------------------------------------- functions */
  FUNCTION_RE.lastIndex = 0
  while ((match = FUNCTION_RE.exec(clean))) {
    const returnType = clip(match[2].replace(/\s+/g, ' '), 60)
    const name = match[3]
    const params = clip(match[4].replace(/\s+/g, ' '), 100)
    add(name, 'function', `${returnType} ${name}(${params})`)
  }

  METHOD_RE.lastIndex = 0
  while ((match = METHOD_RE.exec(clean))) {
    const name = match[2]
    const params = clip(match[3].replace(/\s+/g, ' '), 100)
    add(name, 'function', `${name}(${params})`)
  }

  /* -------------------------------------------- global variables / instances */
  let depth = 0
  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i]
    const trimmed = line.trim()
    if (depth === 0 && trimmed && !trimmed.startsWith('#')) {
      const variable = GLOBAL_VAR_RE.exec(trimmed)
      if (variable) {
        const name = variable[2]
        if (!RESERVED.has(name)) {
          add(name, 'variable', clip(rawLines[i]?.trim() ?? trimmed))
        }
      }
    }
    // Braces inside preprocessor lines should not affect the block depth.
    if (!trimmed.startsWith('#')) {
      for (const ch of line) {
        if (ch === '{') depth++
        else if (ch === '}') depth = Math.max(0, depth - 1)
      }
    }
  }

  return symbols
}

function yieldToIdle(): Promise<void> {
  return new Promise((resolve) => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
    }
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(() => resolve(), { timeout: 120 })
    } else {
      window.setTimeout(resolve, 0)
    }
  })
}

async function rebuildOnce(): Promise<void> {
  let index: ProjectIndex | null = null
  try {
    index = await window.api.project.index()
  } catch {
    return
  }
  if (!index) return

  const next: IndexedSymbol[] = []
  const seen = new Set<string>()
  const files = index.files || []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file || !isIndexableFile(file.path, file.ext || '')) continue
    for (const symbol of parseSymbols(file.path, file.text || '')) {
      if (next.length >= MAX_INDEX_SYMBOLS) break
      if (seen.has(symbol.label)) continue
      seen.add(symbol.label)
      next.push(symbol)
    }
    if (next.length >= MAX_INDEX_SYMBOLS) break
    if (i % 6 === 5) await yieldToIdle()
  }

  workspaceSymbols = next
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      /* listeners must not break the index */
    }
  }
}

/**
 * Rebuilds the workspace index. Concurrent calls are coalesced. The returned
 * promise resolves after the current build (including a queued rebuild).
 */
export function refreshIndex(): Promise<void> {
  if (typeof window === 'undefined' || !window.api?.project?.index) return Promise.resolve()
  if (indexPromise) {
    rebuildRequested = true
    return indexPromise
  }
  const run = async () => {
    do {
      rebuildRequested = false
      await rebuildOnce()
    } while (rebuildRequested)
  }
  indexPromise = run().finally(() => {
    indexPromise = null
  })
  return indexPromise
}

/** Cached workspace symbols; safe to read from a completion source. */
export function getWorkspaceSymbols(): readonly IndexedSymbol[] {
  return workspaceSymbols
}

/** Notifies when the workspace index was rebuilt. */
export function subscribeIndex(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Cached symbols for the currently open document. */
export function getDocumentSymbols(path: string): readonly IndexedSymbol[] {
  return documentSymbols.get(path) ?? EMPTY
}

/**
 * Replaces the cached symbols for one document. Callers should debounce this
 * (it is synchronous); files are capped at 300k characters.
 */
export function setDocumentSymbols(path: string, text: string): void {
  if (!path) return
  const parsed = parseSymbols(path, text)
  documentSymbols.delete(path)
  documentSymbols.set(path, parsed)
  while (documentSymbols.size > DOCUMENT_CACHE_LIMIT) {
    const oldest = documentSymbols.keys().next().value
    if (oldest === undefined) break
    documentSymbols.delete(oldest)
  }
}

/** Clears all cached data (used when the project closes). */
export function resetIndex(): void {
  workspaceSymbols = EMPTY
  documentSymbols.clear()
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      /* ignore */
    }
  }
}
