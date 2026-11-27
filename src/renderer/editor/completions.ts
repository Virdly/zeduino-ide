/**
 * Completion sources for the editor.
 *
 * Everything here is synchronous and reads only cached arrays, which keeps the
 * popup instant even in large workspaces. Workspace and current-file symbols
 * are refreshed in the background by `indexer.ts`.
 */

import {
  completeAnyWord,
  snippetCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import type { TranslateFn } from '../i18n'
import {
  arduinoCompletions,
  type ArduinoEntry,
  type ArduinoSection,
} from './arduino-api'
import {
  getDocumentSymbols,
  getWorkspaceSymbols,
  type IndexedSymbol,
} from './indexer'
import { isCodeFile } from './setup'

interface LocalSnippet {
  label: string
  detail: string
  template: string
}

/** Snippets that make sense in any C/C++ file (Arduino-specific ones live in arduino-api.ts). */
const LOCAL_SNIPPETS: readonly LocalSnippet[] = [
  {
    label: 'function',
    detail: 'returnType name(args) { … }',
    template: '${1:void} ${2:funcName}(${3}) {\n\t${}\n}',
  },
  {
    label: 'foreach',
    detail: 'for (item : collection) { … }',
    template: 'for (${1:auto &item} : ${2:items}) {\n\t${}\n}',
  },
  {
    label: 'include',
    detail: '#include <header>',
    template: '#include <${1:Arduino.h}>',
  },
  {
    label: 'define',
    detail: '#define NAME value',
    template: '#define ${1:NAME} ${2:value}',
  },
  {
    label: 'guard',
    detail: '#ifndef … #define … #endif',
    template: '#ifndef ${1:NAME_H}\n#define ${1:NAME_H}\n\n${}\n\n#endif',
  },
  {
    label: 'comment',
    detail: '// comment',
    template: '// ${}',
  },
  {
    label: 'todo',
    detail: '// TODO: …',
    template: '// TODO: ${}',
  },
]

const SECTION_KEYS: Record<ArduinoSection, string> = {
  digital: 'editor.section.digital',
  analog: 'editor.section.analog',
  advanced: 'editor.section.advanced',
  time: 'editor.section.time',
  math: 'editor.section.math',
  trig: 'editor.section.trig',
  random: 'editor.section.random',
  bits: 'editor.section.bits',
  interrupts: 'editor.section.interrupts',
  serial: 'editor.section.serial',
  string: 'editor.section.string',
  constants: 'editor.section.constants',
  types: 'editor.section.types',
  keywords: 'editor.section.keywords',
  snippets: 'editor.section.snippets',
}

function toArduinoCompletion(entry: ArduinoEntry, t: TranslateFn): Completion {
  const completion: Completion = {
    label: entry.label,
    type: entry.type,
    detail: entry.detail,
    section: t(SECTION_KEYS[entry.section]),
    boost: entry.boost ?? 0,
  }
  return entry.apply ? snippetCompletion(entry.apply, completion) : completion
}

function toSymbolCompletion(
  symbol: IndexedSymbol,
  section: string,
  boost: number,
  showFile: boolean,
): Completion {
  return {
    label: symbol.label,
    type: symbol.type,
    detail: symbol.detail,
    section,
    boost,
    info: showFile ? symbol.file : undefined,
  }
}

export interface CompletionBundleOptions {
  /** Translator read lazily, so a language change only needs `invalidate()`. */
  translate: TranslateFn
  /** Returns the path of the document that is currently open. */
  getPath: () => string
}

export interface CompletionBundle {
  source: CompletionSource
  /** Drops the cached option arrays; they are rebuilt on the next request. */
  invalidate(): void
}

/**
 * Builds a completion bundle with an internally cached list of options. The
 * returned source never performs async work.
 */
export function createCompletionBundle(options: CompletionBundleOptions): CompletionBundle {
  let cache: Completion[] | null = null

  const invalidate = () => {
    cache = null
  }

  const buildOptions = (): Completion[] => {
    const t = options.translate
    const path = options.getPath()
    const result: Completion[] = []
    const seen = new Set<string>()
    const push = (completion: Completion) => {
      const key = completion.label.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      result.push(completion)
    }

    /* Symbols from the current document win over everything else. */
    const documentSection = t('editor.section.document')
    for (const symbol of getDocumentSymbols(path)) {
      push(toSymbolCompletion(symbol, documentSection, 30, false))
    }

    /* Project symbols, skipping the file that is already indexed locally. */
    const projectSection = t('editor.section.project')
    for (const symbol of getWorkspaceSymbols()) {
      if (symbol.file === path) continue
      push(toSymbolCompletion(symbol, projectSection, 15, true))
    }

    if (isCodeFile(path)) {
      for (const entry of arduinoCompletions) {
        push(toArduinoCompletion(entry, t))
      }
      const snippetSection = t('editor.section.snippets')
      for (const snippet of LOCAL_SNIPPETS) {
        push(
          snippetCompletion(snippet.template, {
            label: snippet.label,
            type: 'keyword',
            detail: snippet.detail,
            section: snippetSection,
            boost: 5,
          }),
        )
      }
    }

    return result
  }

  const getOptions = (): Completion[] => {
    if (!cache) cache = buildOptions()
    return cache
  }

  const source: CompletionSource = (context): CompletionResult | null => {
    const { state, pos } = context
    const line = state.doc.lineAt(pos)
    const before = line.text.slice(0, pos - line.from)

    /* Member access: offer only the matching `Object.method` entries. The
       completed range includes the object name because the labels do too. */
    const member = /([A-Za-z_]\w*)\.([\w$]*)$/.exec(before)
    if (member) {
      const memberStart = pos - member[0].length
      const previous = memberStart > line.from ? line.text[memberStart - line.from - 1] : ''
      if (!previous || !/[\w$.]/.test(previous)) {
        const prefix = `${member[1]}.`
        const members = getOptions().filter((completion) => completion.label.startsWith(prefix))
        if (members.length) {
          return {
            from: memberStart,
            options: members,
            validFor: /^[\w$.]*$/,
          }
        }
      }
    }

    const word = context.matchBefore(/[\w$]+/)
    if (word) {
      return {
        from: word.from,
        options: getOptions(),
        validFor: /^[\w$]*$/,
      }
    }

    if (context.explicit) {
      return {
        from: pos,
        options: getOptions(),
        validFor: /^[\w$]*$/,
      }
    }

    return null
  }

  return { source, invalidate }
}
