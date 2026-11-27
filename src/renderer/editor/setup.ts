/**
 * Shared CodeMirror 6 configuration for the ZedArduino editor.
 *
 * Everything that can be changed at runtime lives in a compartment so that
 * live settings updates never recreate the editor state (and therefore never
 * drop the undo history).
 */

import {
  Compartment,
  EditorState,
  type Extension,
  type StateEffect,
} from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
  rectangularSelection,
  tooltips,
  type Command,
} from '@codemirror/view'
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from '@codemirror/commands'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { cpp } from '@codemirror/lang-cpp'
import { search, searchKeymap } from '@codemirror/search'
import { tags as tg } from '@lezer/highlight'
import type { EditorSettings } from '../../shared/types'
import type { TranslateFn } from '../i18n'

/** File extensions parsed with the C++ language mode. */
const CPP_EXTENSIONS = new Set([
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

/** True for sketch / C / C++ files. Everything else opens as plain text. */
export function isCodeFile(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return CPP_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

/** Language support for a path: C++ for sketches and sources, plaintext otherwise. */
export function languageForPath(path: string): Extension {
  return isCodeFile(path) ? cpp() : []
}

/** Compartments that are reconfigured when settings or the active file change. */
export interface EditorCompartments {
  language: Compartment
  indent: Compartment
  wrap: Compartment
  gutters: Compartment
  activeLine: Compartment
  bracket: Compartment
  autocomplete: Compartment
  theme: Compartment
  ui: Compartment
}

export interface EditorSetupOptions {
  settings: EditorSettings
  path: string
  t: TranslateFn
  completionSource: CompletionSource
  onSave: () => void
}

export interface EditorSetup {
  extensions: Extension[]
  compartments: EditorCompartments
}

/** Snippet-friendly indentation settings. */
function indentExtensions(tabSize: number): Extension {
  const size = Math.max(1, Math.floor(tabSize) || 2)
  return [EditorState.tabSize.of(size), indentUnit.of(' '.repeat(size))]
}

/**
 * Tab inserts spaces (or indents the selected lines). While a snippet is
 * active CodeMirror's snippet keymap has higher precedence and Tab moves to
 * the next snippet field instead.
 */
const insertTabSpaces: Command = (view) => {
  const { state } = view
  if (state.readOnly) return false
  if (state.selection.ranges.some((range) => !range.empty)) return indentMore(view)
  view.dispatch({
    ...state.replaceSelection(' '.repeat(state.tabSize)),
    scrollIntoView: true,
    userEvent: 'input.indent',
  })
  return true
}

function editorKeymap(onSave: () => void): Extension {
  return keymap.of([
    { key: 'Tab', run: insertTabSpaces, preventDefault: true },
    { key: 'Shift-Tab', run: indentLess, preventDefault: true },
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        onSave()
        return true
      },
    },
  ])
}

/**
 * Theme values that must follow the app's CSS variables. Font size and family
 * are deliberately read from `--editor-font-size` / `--editor-font-family`.
 */
export function editorTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--editor-text)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--editor-font-family)',
      fontSize: 'var(--editor-font-size)',
      lineHeight: '1.55',
      overscrollBehavior: 'contain',
    },
    '.cm-content': {
      fontFamily: 'var(--editor-font-family)',
      caretColor: 'var(--editor-cursor)',
      padding: '4px 0',
    },
    '.cm-line': { padding: '0 10px 0 6px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-cursor)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--editor-selection)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-bg)',
      color: 'var(--editor-gutter)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--editor-active-gutter)',
      color: 'var(--editor-text)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-elevated)',
      color: 'var(--text)',
      border: '1px solid var(--border)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent-soft)',
      color: 'var(--text)',
    },
    '.cm-panels': { backgroundColor: 'var(--bg-elevated)', color: 'var(--text)' },
    '.cm-panel.cm-search': { fontFamily: 'var(--font-ui)' },
    '.cm-searchMatch': { backgroundColor: 'var(--editor-search-match)' },
    '.cm-snippetField': { backgroundColor: 'var(--editor-snippet-field)' },
    '.cm-snippetFieldPosition': { borderLeftColor: 'var(--editor-cursor)' },
  })
}

/**
 * Completion phrases passed to CodeMirror. This localizes the built-in search
 * panel (whose labels come from `EditorState.phrases`) and match announcements.
 */
export function editorPhrases(t: TranslateFn): Record<string, string> {
  return {
    Find: t('editor.search.find'),
    Replace: t('editor.search.replace'),
    next: t('editor.search.next'),
    previous: t('editor.search.prev'),
    all: t('editor.search.all'),
    'match case': t('editor.search.matchCase'),
    regexp: t('editor.search.regexp'),
    'by word': t('editor.search.byWord'),
    replace: t('editor.search.replaceOne'),
    'replace all': t('editor.search.replaceAll'),
    close: t('editor.search.close'),
    'current match': t('editor.search.currentMatch'),
    'on line': t('editor.search.onLine'),
    'replaced match on line $': t('editor.search.replacedMatch'),
    'replaced $ matches': t('editor.search.replacedMatches'),
    'Go to line': t('editor.search.goToLine'),
    Completions: t('editor.search.completions'),
  }
}

/** Localizable UI extensions (aria label, phrases, placeholder). */
export function uiExtensions(t: TranslateFn): Extension {
  return [
    EditorState.phrases.of(editorPhrases(t)),
    EditorView.contentAttributes.of({
      'aria-label': t('editor.aria.editor'),
      'aria-multiline': 'true',
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
      translate: 'no',
    }),
    placeholder(t('editor.placeholder')),
  ]
}

/**
 * Autocompletion tuned for an instant local response: both sources are
 * synchronous and the typing delay is short.
 */
export function autocompleteExtension(source: CompletionSource): Extension {
  return [
    autocompletion({
      override: [source, completeAnyWord],
      activateOnTyping: true,
      activateOnTypingDelay: 40,
      selectOnOpen: true,
      closeOnBlur: true,
      maxRenderedOptions: 80,
      updateSyncTime: 30,
    }),
    // Render the popup above the bottom panel instead of clipping it inside
    // the editor viewport.
    tooltips({ parent: document.body }),
  ]
}

/** One dispatch effect per runtime setting. */
export function settingsEffects(
  compartments: EditorCompartments,
  settings: EditorSettings,
  completionSource: CompletionSource,
): StateEffect<unknown>[] {
  return [
    compartments.indent.reconfigure(indentExtensions(settings.tabSize)),
    compartments.wrap.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
    compartments.gutters.reconfigure(
      settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
    ),
    compartments.activeLine.reconfigure(settings.highlightActiveLine ? highlightActiveLine() : []),
    compartments.bracket.reconfigure(settings.bracketMatching ? bracketMatching() : []),
    compartments.autocomplete.reconfigure(
      settings.autocomplete ? autocompleteExtension(completionSource) : [],
    ),
    compartments.theme.reconfigure(editorTheme()),
  ]
}

/**
 * Creates the initial set of extensions plus the compartments used for live
 * reconfiguration. The editor state itself keeps living across reconfigures.
 */
export function createEditorSetup(options: EditorSetupOptions): EditorSetup {
  const { settings, t, completionSource } = options
  const compartments: EditorCompartments = {
    language: new Compartment(),
    indent: new Compartment(),
    wrap: new Compartment(),
    gutters: new Compartment(),
    activeLine: new Compartment(),
    bracket: new Compartment(),
    autocomplete: new Compartment(),
    theme: new Compartment(),
    ui: new Compartment(),
  }

  const extensions: Extension[] = [
    /* Sizing/fonts come from CSS variables; the compartment lets us refresh it. */
    compartments.theme.of(editorTheme()),

    /* Localized aria label, phrases (search panel) and placeholder. */
    compartments.ui.of(uiExtensions(t)),

    /* Our bindings must come before the general keymaps. */
    editorKeymap(options.onSave),
    keymap.of(closeBracketsKeymap),
    keymap.of(defaultKeymap),
    keymap.of(searchKeymap),
    keymap.of(historyKeymap),

    /* Core editor behaviour. */
    history(),
    drawSelection(),
    dropCursor(),
    highlightSpecialChars(),
    rectangularSelection(),
    crosshairCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    closeBrackets(),

    /* Live settings. */
    compartments.language.of(languageForPath(options.path)),
    compartments.indent.of(indentExtensions(settings.tabSize)),
    compartments.wrap.of(settings.wordWrap ? EditorView.lineWrapping : []),
    compartments.gutters.of(
      settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [],
    ),
    compartments.activeLine.of(settings.highlightActiveLine ? highlightActiveLine() : []),
    compartments.bracket.of(settings.bracketMatching ? bracketMatching() : []),
    compartments.autocomplete.of(
      settings.autocomplete ? autocompleteExtension(completionSource) : [],
    ),

    /* Syntax colours + search. */
    syntaxHighlighting(editorHighlightStyle),
    search({ top: true }),
  ]

  return { extensions, compartments }
}

/**
 * Syntax highlighting driven entirely by CSS variables from editor.css, with
 * separate dark/light values selected through `[data-theme]`.
 */
export const editorHighlightStyle = HighlightStyle.define([
  {
    tag: [tg.comment, tg.lineComment, tg.blockComment],
    color: 'var(--editor-syntax-comment)',
    fontStyle: 'italic',
  },
  { tag: tg.docComment, color: 'var(--editor-syntax-doc-comment)', fontStyle: 'italic' },
  {
    tag: [tg.keyword, tg.self, tg.atom, tg.unit],
    color: 'var(--editor-syntax-keyword)',
  },
  {
    tag: [tg.controlKeyword, tg.definitionKeyword, tg.moduleKeyword, tg.operatorKeyword, tg.modifier],
    color: 'var(--editor-syntax-control)',
    fontWeight: '600',
  },
  {
    tag: [
      tg.string,
      tg.docString,
      tg.character,
      tg.attributeValue,
      tg.regexp,
      tg.escape,
      tg.url,
      tg.color,
    ],
    color: 'var(--editor-syntax-string)',
  },
  { tag: [tg.number, tg.integer, tg.float], color: 'var(--editor-syntax-number)' },
  { tag: [tg.bool, tg.null], color: 'var(--editor-syntax-atom)' },
  {
    tag: [tg.typeName, tg.className, tg.namespace, tg.tagName],
    color: 'var(--editor-syntax-type)',
  },
  {
    tag: [tg.function(tg.variableName), tg.function(tg.propertyName), tg.macroName],
    color: 'var(--editor-syntax-function)',
  },
  {
    tag: [tg.definition(tg.variableName), tg.definition(tg.propertyName)],
    color: 'var(--editor-syntax-variable)',
  },
  { tag: [tg.propertyName, tg.attributeName], color: 'var(--editor-syntax-property)' },
  {
    tag: [
      tg.operator,
      tg.derefOperator,
      tg.arithmeticOperator,
      tg.logicOperator,
      tg.bitwiseOperator,
      tg.compareOperator,
      tg.updateOperator,
      tg.definitionOperator,
      tg.typeOperator,
      tg.controlOperator,
    ],
    color: 'var(--editor-syntax-operator)',
  },
  {
    tag: [
      tg.punctuation,
      tg.separator,
      tg.bracket,
      tg.angleBracket,
      tg.squareBracket,
      tg.paren,
      tg.brace,
    ],
    color: 'var(--editor-syntax-bracket)',
  },
  {
    tag: [tg.meta, tg.documentMeta, tg.annotation, tg.processingInstruction],
    color: 'var(--editor-syntax-meta)',
  },
  { tag: tg.invalid, color: 'var(--editor-syntax-invalid)', textDecoration: 'underline wavy' },
  { tag: [tg.heading, tg.strong], fontWeight: '600', color: 'var(--editor-syntax-keyword)' },
  { tag: [tg.emphasis, tg.quote], fontStyle: 'italic' },
  { tag: [tg.link], color: 'var(--editor-syntax-function)', textDecoration: 'underline' },
])
