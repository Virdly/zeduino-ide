import { useEffect, useLayoutEffect, useRef } from 'react'
import { Annotation, EditorState, Transaction, type Extension } from '@codemirror/state'
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import type { EditorSettings } from '../../shared/types'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'
import {
  createEditorSetup,
  isCodeFile,
  languageForPath,
  settingsEffects,
  uiExtensions,
  type EditorCompartments,
} from './setup'
import { formatEditorSelection } from './formatter'
import { createCompletionBundle, type CompletionBundle } from './completions'
import {
  refreshIndex,
  resetIndex,
  setDocumentSymbols,
  subscribeIndex,
} from './indexer'
import '../styles/editor.css'

export interface CodeEditorProps {
  path: string
  value: string
  onChange(text: string): void
  onSave(): void
  onCursor?(line: number, col: number, selectionLength: number): void
}

/** Detail of the custom `zeduino:editor` window event. */
export interface EditorCommandDetail {
  action?: string
  line?: number
  column?: number
}

/** Marks a document replacement that came from the `value` prop, not the user. */
const externalChange = Annotation.define<boolean>()

const DOCUMENT_SYMBOL_DELAY = 180
const INDEX_DEBOUNCE = 800

export function CodeEditor({ path, value, onChange, onSave, onCursor }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const compartmentsRef = useRef<EditorCompartments | null>(null)
  const bundleRef = useRef<CompletionBundle | null>(null)

  const t = useT()
  const settings = useApp((s) => s.settings.editor)
  const projectRoot = useApp((s) => (s.project ? s.project.root : ''))
  const tree = useApp((s) => s.tree)
  const problems = useApp((s) => s.problems)

  const tRef = useRef(t)
  const pathRef = useRef(path)
  const valueRef = useRef(value)
  const settingsRef = useRef(settings)
  const projectRootRef = useRef(projectRoot)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onCursorRef = useRef(onCursor)

  const docSymbolsTimer = useRef<number | null>(null)
  const indexTimer = useRef<number | null>(null)
  const indexEffectReady = useRef(false)
  const previousProjectRoot = useRef(projectRoot)

  /* Keep the latest props/handlers available to long-lived CodeMirror extensions. */
  useLayoutEffect(() => {
    tRef.current = t
    pathRef.current = path
    valueRef.current = value
    settingsRef.current = settings
    projectRootRef.current = projectRoot
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onCursorRef.current = onCursor
  }, [t, path, value, settings, projectRoot, onChange, onSave, onCursor])

  const reportCursor = (state: EditorState) => {
    const callback = onCursorRef.current
    if (!callback) return
    const range = state.selection.main
    const line = state.doc.lineAt(range.head)
    callback(line.number, range.head - line.from + 1, range.to - range.from)
  }

  const scheduleDocumentSymbols = (text: string, filePath: string) => {
    if (docSymbolsTimer.current !== null) window.clearTimeout(docSymbolsTimer.current)
    docSymbolsTimer.current = window.setTimeout(() => {
      docSymbolsTimer.current = null
      setDocumentSymbols(filePath, text)
      bundleRef.current?.invalidate()
    }, DOCUMENT_SYMBOL_DELAY)
  }

  const scheduleIndexRefresh = (delay: number) => {
    if (indexTimer.current !== null) window.clearTimeout(indexTimer.current)
    indexTimer.current = window.setTimeout(() => {
      indexTimer.current = null
      void refreshIndex()
    }, delay)
  }

  /** Ctrl+T: auto-format (re-indent) the selection or the whole C/C++ file. */
  const runFormat = (view: EditorView): boolean => {
    if (!isCodeFile(pathRef.current)) {
      useApp.getState().showToast('warning', tRef.current('editor.formatUnavailable'))
      return false
    }
    const applied = formatEditorSelection(view, settingsRef.current.tabSize)
    if (applied) {
      useApp.getState().showToast('success', tRef.current('editor.formatted'))
    }
    return applied
  }

  /* Create the editor exactly once. Settings and language are reconfigured
     through compartments below, so the undo history survives. */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const bundle = createCompletionBundle({
      translate: (key, vars) => tRef.current(key, vars),
      getPath: () => pathRef.current,
    })
    bundleRef.current = bundle

    const setup = createEditorSetup({
      settings: settingsRef.current,
      path: pathRef.current,
      t: (key, vars) => tRef.current(key, vars),
      completionSource: bundle.source,
      onSave: () => {
        onSaveRef.current()
        // The store writes the file asynchronously; re-read the index shortly after.
        scheduleIndexRefresh(900)
      },
    })
    compartmentsRef.current = setup.compartments

    const extensions: Extension[] = [
      setup.extensions,
      keymap.of([
        {
          key: 'Mod-t',
          preventDefault: true,
          run: (view) => runFormat(view),
        },
      ]),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          const text = update.state.doc.toString()
          const fromProps = update.transactions.some(
            (transaction) => transaction.annotation(externalChange) === true,
          )
          if (!fromProps) onChangeRef.current(text)
          scheduleDocumentSymbols(text, pathRef.current)
        }
        if (update.docChanged || update.selectionSet) reportCursor(update.state)
      }),
      EditorView.domEventHandlers({
        focus: () => {
          const current = viewRef.current
          if (current) reportCursor(current.state)
          return false
        },
      }),
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: valueRef.current, extensions }),
      parent: host,
    })
    viewRef.current = view

    const unsubscribeIndex = subscribeIndex(() => bundle.invalidate())
    const unsubscribeFs = window.api?.project?.onFsChanged
      ? window.api.project.onFsChanged(() => scheduleIndexRefresh(INDEX_DEBOUNCE))
      : () => undefined

    /* Prime completions for the already open document. */
    setDocumentSymbols(pathRef.current, valueRef.current)
    scheduleIndexRefresh(0)
    reportCursor(view.state)

    return () => {
      unsubscribeIndex()
      unsubscribeFs()
      if (docSymbolsTimer.current !== null) {
        window.clearTimeout(docSymbolsTimer.current)
        docSymbolsTimer.current = null
      }
      if (indexTimer.current !== null) {
        window.clearTimeout(indexTimer.current)
        indexTimer.current = null
      }
      viewRef.current = null
      compartmentsRef.current = null
      bundleRef.current = null
      view.destroy()
    }
  }, [])

  /* The editor may be reused for another file when the tab is not keyed. */
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const compartments = compartmentsRef.current
    if (compartments) {
      view.dispatch({ effects: compartments.language.reconfigure(languageForPath(path)) })
    }
    bundleRef.current?.invalidate()
    scheduleDocumentSymbols(view.state.doc.toString(), path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  /* External content changes (auto-save reload, file watcher) preserve history. */
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) {
      valueRef.current = value
      return
    }

    const selection = view.state.selection.main
    const currentLine = view.state.doc.lineAt(selection.head)
    const column = selection.head - currentLine.from
    const nextText = view.state.toText(value)
    const nextLineNumber = Math.min(currentLine.number, nextText.lines)
    const nextLine = nextText.line(nextLineNumber)
    const head = nextLine.from + Math.min(column, nextLine.length)

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: head },
      annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
    })
  }, [value])

  /* Show arduino-cli problems for this file as inline lint markers. */
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentPath = path.replace(/\\/g, '/').toLowerCase()
    const currentName = currentPath.split('/').pop() ?? currentPath
    const doc = view.state.doc
    const diagnostics: Diagnostic[] = []

    for (const problem of problems) {
      const reported = problem.file.replace(/\\/g, '/').toLowerCase()
      const sameFile =
        reported === currentPath ||
        reported.endsWith(`/${currentPath}`) ||
        (reported.split('/').pop() ?? reported) === currentName
      if (!sameFile) continue

      const lineNumber = Math.min(doc.lines, Math.max(1, Math.floor(problem.line) || 1))
      const line = doc.line(lineNumber)
      const column = Math.min(Math.max(0, (problem.column ?? 1) - 1), line.length)
      const from = line.from + column
      diagnostics.push({
        from,
        to: Math.min(line.to, from + 1),
        severity: problem.severity,
        message: problem.message,
        source: 'arduino-cli',
      })
    }

    view.dispatch(setDiagnostics(view.state, diagnostics))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problems, path])

  /* Live editor settings; each one is reconfigured in place. */
  useEffect(() => {
    const view = viewRef.current
    const compartments = compartmentsRef.current
    const bundle = bundleRef.current
    if (!view || !compartments || !bundle) return
    view.dispatch({ effects: settingsEffects(compartments, settings, bundle.source) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.tabSize,
    settings.wordWrap,
    settings.lineNumbers,
    settings.autocomplete,
    settings.highlightActiveLine,
    settings.bracketMatching,
    settings.fontSize,
    settings.fontFamily,
  ])

  /* Localize the built-in search panel / aria labels when the UI language changes. */
  useEffect(() => {
    const view = viewRef.current
    const compartments = compartmentsRef.current
    if (!view || !compartments) return
    view.dispatch({ effects: compartments.ui.reconfigure(uiExtensions(t)) })
    bundleRef.current?.invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  /* Rebuild the workspace index when the project or its file tree changes. */
  useEffect(() => {
    if (!indexEffectReady.current) {
      indexEffectReady.current = true
      return
    }
    if (!projectRoot) {
      resetIndex()
      bundleRef.current?.invalidate()
      previousProjectRoot.current = projectRoot
      return
    }
    if (previousProjectRoot.current !== projectRoot) {
      previousProjectRoot.current = projectRoot
      resetIndex()
      bundleRef.current?.invalidate()
    }
    scheduleIndexRefresh(INDEX_DEBOUNCE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRoot, tree])

  /* Catch changes made while the window was in the background. */
  useEffect(() => {
    const handleWindowFocus = () => {
      if (!projectRootRef.current) return
      scheduleIndexRefresh(1200)
    }
    window.addEventListener('focus', handleWindowFocus)
    return () => window.removeEventListener('focus', handleWindowFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Editor commands coming from the application menu / cmd palette / search sidebar. */
  useEffect(() => {
    const handleEditorCommand = (event: Event) => {
      const view = viewRef.current
      if (!view) return
      const detail = (event as CustomEvent<EditorCommandDetail>).detail
      if (!detail || typeof detail.action !== 'string') return

      switch (detail.action) {
        case 'find':
          openSearchPanel(view)
          break
        case 'replace': {
          openSearchPanel(view)
          window.requestAnimationFrame(() => {
            if (!view.dom.isConnected) return
            const replaceField = view.dom.querySelector<HTMLInputElement>(
              '.cm-search input[name="replace"]',
            )
            if (!replaceField) return
            replaceField.focus()
            replaceField.select()
          })
          break
        }
        case 'goto': {
          const doc = view.state.doc
          const requestedLine =
            typeof detail.line === 'number' && Number.isFinite(detail.line)
              ? Math.floor(detail.line)
              : 1
          const requestedColumn =
            typeof detail.column === 'number' && Number.isFinite(detail.column)
              ? Math.floor(detail.column)
              : 1
          const lineNumber = Math.min(doc.lines, Math.max(1, requestedLine))
          const line = doc.line(lineNumber)
          const column = Math.min(line.length + 1, Math.max(1, requestedColumn))
          view.dispatch({
            selection: { anchor: line.from + column - 1 },
            scrollIntoView: true,
            userEvent: 'select.goto',
          })
          view.focus()
          break
        }
        case 'undo':
          undo(view)
          view.focus()
          break
        case 'redo':
          redo(view)
          view.focus()
          break
        case 'format':
          runFormat(view)
          view.focus()
          break
        default:
          break
      }
    }

    window.addEventListener('zeduino:editor', handleEditorCommand)
    return () => window.removeEventListener('zeduino:editor', handleEditorCommand)
  }, [])

  return <div className="editor-host" ref={hostRef} />
}
