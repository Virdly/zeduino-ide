import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { DARK_COLORS, LIGHT_COLORS, isLight, withAlpha } from '../../shared/theme'
import type {
  AppSettings,
  BoardDetails,
  BoardEntry,
  CliStatus,
  CompileResult,
  ConnectedBoard,
  FileNode,
  ProjectInfo,
  WorkspaceSearchResult,
} from '../../shared/types'
import { createTranslator } from '../i18n'

export type SidebarView = 'files' | 'search' | 'boards' | 'libraries'
export type PanelView = 'output' | 'serial' | 'problems' | 'terminal'
export type RunKind = 'compile' | 'upload' | 'cli' | 'setup'

export interface OutputLine {
  id: number
  text: string
  stream: 'stdout' | 'stderr' | 'system'
}

export interface ProblemItem {
  id: number
  file: string
  line: number
  column?: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface EditorTab {
  path: string
  name: string
  content: string
  saved: string
}

export interface PromptState {
  title: string
  label?: string
  value: string
  placeholder?: string
  hint?: string
  confirmLabel?: string
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void | Promise<void>
}

export interface ConfirmState {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

export interface ToastState {
  id: number
  kind: 'info' | 'success' | 'error' | 'warning'
  message: string
}

export interface MonitorUiState {
  running: boolean
  port: string
  baud: number
  error?: string
  buffer: string
  timestamps: boolean
  autoScroll: boolean
}

export interface DialogState {
  settings: boolean
  boards: boolean
  libraries: boolean
  theme: boolean
  newSketch: boolean
}

export interface AppStore {
  ready: boolean
  settings: AppSettings
  project: ProjectInfo | null
  tree: FileNode[]
  tabs: EditorTab[]
  activePath: string | null
  recent: string[]
  sidebarView: SidebarView
  sidebarVisible: boolean
  panelVisible: boolean
  panelView: PanelView
  panelHeight: number
  aiVisible: boolean
  dialogs: DialogState
  prompt: PromptState | null
  confirm: ConfirmState | null
  toast: ToastState | null
  output: OutputLine[]
  problems: ProblemItem[]
  running: { kind: RunKind; title: string } | null
  progress: { task: string; percent?: number; detail?: string } | null
  lastCompile: CompileResult | null
  statusText: string
  monitor: MonitorUiState
  ports: ConnectedBoard[]
  boards: BoardEntry[]
  boardDetails: BoardDetails | null
  cliStatus: CliStatus | null
  searchQuery: string
  searchResults: WorkspaceSearchResult[]
  searchBusy: boolean
  newSketchParent: string
  aiBusy: boolean

  init(): Promise<void>
  applyTheme(): void
  updateSettings(patch: Record<string, unknown>): Promise<void>
  resetSettings(): Promise<void>
  setLanguage(lang: 'ru' | 'en'): Promise<void>
  setSidebarView(view: SidebarView): void
  setSidebarVisible(visible: boolean): void
  setPanelView(view: PanelView): void
  setPanelVisible(visible: boolean): void
  setPanelHeight(height: number): void
  setAiVisible(visible: boolean): void
  setDialog<K extends keyof DialogState>(key: K, value: DialogState[K]): void
  showPrompt(prompt: PromptState): void
  closePrompt(): void
  showConfirm(confirm: ConfirmState): void
  closeConfirm(): void
  showToast(kind: ToastState['kind'], message: string): void
  clearToast(): void
  pushOutput(text: string, stream: OutputLine['stream']): void
  clearOutput(): void
  setStatusText(text: string): void

  projectOpenDialog(): Promise<void>
  projectOpen(root: string): Promise<void>
  projectClose(): Promise<void>
  refreshTree(): Promise<void>
  refreshRecent(): Promise<void>
  openFile(path: string): Promise<void>
  activateTab(path: string): void
  updateTabContent(path: string, content: string): void
  saveTab(path: string): Promise<boolean>
  saveActive(): Promise<boolean>
  saveAll(): Promise<void>
  closeTab(path: string, force?: boolean): Promise<void>
  reloadActiveIfClean(): Promise<void>
  createEntry(kind: 'file' | 'folder', dirRel: string): Promise<void>
  renameEntry(relPath: string, currentName: string): Promise<void>
  deleteEntry(relPath: string, name: string): Promise<void>
  revealEntry(relPath: string): Promise<void>

  loadArduinoData(force?: boolean): Promise<void>
  ensureCli(): Promise<void>
  refreshPorts(): Promise<void>
  setBoard(fqbn: string): Promise<void>
  setPort(port: string): void
  setBaud(baud: number): Promise<void>
  setBoardOption(optionId: string, value: string): Promise<void>

  compile(): Promise<boolean>
  upload(): Promise<void>
  cancelRun(): Promise<void>
  toggleMonitor(): Promise<void>
  startMonitor(): Promise<void>
  stopMonitor(): Promise<void>
  sendSerial(text: string): Promise<void>
  clearSerial(): void
  runAction(action: string): void
  setSearchQuery(query: string): Promise<void>
  sketchDir(): string | null
  t(): (key: string, vars?: Record<string, string | number>) => string
}

let outputSeq = 0
let problemSeq = 0
let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null
let fsReloadTimer: ReturnType<typeof setTimeout> | null = null
const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

const MAX_OUTPUT_LINES = 4000
const MAX_SERIAL_CHARS = 200_000

function posixDir(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx < 0 ? '' : relPath.slice(0, idx)
}

function joinAbs(root: string, rel: string): string {
  if (!rel) return root
  return `${root.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}`
}

function parseProblems(lines: string[]): ProblemItem[] {
  const items: ProblemItem[] = []
  const re = /^(.+?\.(?:ino|h|hpp|c|cpp|cxx|cc)):(\d+):(\d+)?:?\s*(error|warning|fatal error|note):\s*(.+)$/i
  for (const line of lines) {
    const clean = line.replace(/^\s+/, '')
    const m = clean.match(re)
    if (m) {
      items.push({
        id: ++problemSeq,
        file: m[1],
        line: Number(m[2]),
        column: m[3] ? Number(m[3]) : undefined,
        severity: m[4].toLowerCase().includes('warning') ? 'warning' : m[4].toLowerCase() === 'note' ? 'info' : 'error',
        message: m[5].trim(),
      })
    }
  }
  return items.slice(0, 500)
}

export const useApp = create<AppStore>((set, get) => ({
  ready: false,
  settings: structuredClone(DEFAULT_SETTINGS),
  project: null,
  tree: [],
  tabs: [],
  activePath: null,
  recent: [],
  sidebarView: 'files',
  sidebarVisible: true,
  panelVisible: true,
  panelView: 'output',
  panelHeight: 240,
  aiVisible: false,
  dialogs: { settings: false, boards: false, libraries: false, theme: false, newSketch: false },
  prompt: null,
  confirm: null,
  toast: null,
  output: [],
  problems: [],
  running: null,
  progress: null,
  lastCompile: null,
  statusText: '',
  monitor: { running: false, port: '', baud: 9600, buffer: '', timestamps: false, autoScroll: true },
  ports: [],
  boards: [],
  boardDetails: null,
  cliStatus: null,
  searchQuery: '',
  searchResults: [],
  searchBusy: false,
  newSketchParent: '',
  aiBusy: false,

  t: () => createTranslator(get().settings.language),

  init: async () => {
    const api = window.api
    try {
      const [settings, current, recent] = await Promise.all([api.settings.get(), api.project.current().catch(() => null), api.project.recent()])
      set({ settings, project: current, recent, ready: true, monitor: { ...get().monitor, baud: settings.arduino.baud, port: settings.arduino.port } })
      get().applyTheme()
      if (current) {
        await get().refreshTree()
        if (current.isSketch && current.sketchName) await get().openFile(`${current.sketchName}.ino`)
      }
    } catch (err) {
      console.error('[store] init failed', err)
      set({ ready: true })
      get().applyTheme()
    }

    api.arduino.onOutput((e) => get().pushOutput(e.text, e.stream))
    api.arduino.onRunStarted((e) => {
      set({ running: { kind: e.kind, title: e.title }, progress: null })
      if (e.kind === 'compile' || e.kind === 'upload') {
        set({ output: [], problems: [], panelVisible: true, panelView: 'output' })
      }
      get().setStatusText(e.title)
    })
    api.arduino.onRunDone((e) => {
      set({ running: null, progress: null })
      get().setStatusText('')
      if (e.kind === 'compile' || e.kind === 'upload') {
        void get().refreshPorts()
      }
    })
    api.arduino.onProgress((e) => set({ progress: e }))
    api.monitor.onData((e) => {
      const state = get().monitor
      let buffer = state.buffer + e.text
      if (buffer.length > MAX_SERIAL_CHARS) buffer = buffer.slice(buffer.length - MAX_SERIAL_CHARS)
      set({ monitor: { ...state, buffer } })
    })
    api.monitor.onState((e) => {
      const state = get().monitor
      set({ monitor: { ...state, running: e.running, port: e.port ?? state.port, baud: e.baud ?? state.baud, error: e.error } })
    })
    api.project.onChanged((info) => {
      set({ project: info, tabs: [], activePath: null, tree: [], searchResults: [] })
      if (info) void get().refreshTree()
      void get().refreshRecent()
    })
    api.project.onFsChanged(() => {
      if (fsReloadTimer) clearTimeout(fsReloadTimer)
      fsReloadTimer = setTimeout(() => {
        void get().refreshTree()
        void get().reloadActiveIfClean()
      }, 300)
    })
    api.app.onMenu((action) => get().runAction(action))

    void get().loadArduinoData()
    setInterval(() => {
      if (!get().running && get().cliStatus?.installed) void get().refreshPorts()
    }, 7000)
  },

  applyTheme: () => {
    const { theme, editor } = get().settings
    const base = theme.mode === 'light' ? LIGHT_COLORS : DARK_COLORS
    const own = theme.mode === 'custom' ? (theme.colors.bg && isLight(theme.colors.bg) ? LIGHT_COLORS : DARK_COLORS) : base
    const colors = { ...own, ...theme.colors }
    if (theme.accent) colors.accent = theme.accent
    const root = document.documentElement
    const vars: Record<string, string> = {
      '--bg': colors.bg,
      '--bg-elevated': colors.bgElevated,
      '--bg-panel': colors.bgPanel,
      '--bg-hover': colors.bgHover,
      '--bg-active': colors.bgActive,
      '--border': colors.border,
      '--text': colors.text,
      '--text-muted': colors.textMuted,
      '--accent': colors.accent,
      '--accent-text': colors.accentText,
      '--selection': colors.selection,
      '--error': colors.error,
      '--warning': colors.warning,
      '--success': colors.success,
      '--info': colors.info,
      '--editor-bg': colors.editorBg,
      '--editor-text': colors.editorText,
      '--editor-gutter': colors.editorGutter,
      '--editor-cursor': colors.editorCursor,
      '--editor-selection': colors.editorSelection,
      '--accent-soft': withAlpha(colors.accent, 0.16),
      '--accent-border': withAlpha(colors.accent, 0.45),
      '--error-soft': withAlpha(colors.error, 0.14),
      '--warning-soft': withAlpha(colors.warning, 0.14),
      '--success-soft': withAlpha(colors.success, 0.14),
      '--ui-scale': String(theme.uiScale || 1),
      '--editor-font-size': `${editor.fontSize}px`,
      '--editor-font-family': editor.fontFamily,
    }
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
    root.dataset.theme = isLight(colors.bg) ? 'light' : 'dark'
    root.style.colorScheme = isLight(colors.bg) ? 'light' : 'dark'
  },

  updateSettings: async (patch) => {
    const next = await window.api.settings.update(patch)
    set({ settings: next, monitor: { ...get().monitor, baud: next.arduino.baud } })
    get().applyTheme()
  },

  resetSettings: async () => {
    const next = await window.api.settings.reset()
    set({ settings: next })
    get().applyTheme()
    get().showToast('success', get().t()('common.success'))
  },

  setLanguage: async (lang) => {
    await get().updateSettings({ language: lang })
  },

  setSidebarView: (view) => set({ sidebarView: view, sidebarVisible: true }),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  setPanelView: (view) => set({ panelView: view, panelVisible: true }),
  setPanelVisible: (visible) => set({ panelVisible: visible }),
  setPanelHeight: (height) => set({ panelHeight: Math.max(120, Math.min(640, height)) }),
  setAiVisible: (visible) => set({ aiVisible: visible }),
  setDialog: (key, value) => set((s) => ({ dialogs: { ...s.dialogs, [key]: value } })),
  showPrompt: (prompt) => set({ prompt }),
  closePrompt: () => set({ prompt: null }),
  showConfirm: (confirm) => set({ confirm }),
  closeConfirm: () => set({ confirm: null }),

  showToast: (kind, message) => {
    const id = ++toastSeq
    set({ toast: { id, kind, message } })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 5000)
  },
  clearToast: () => set({ toast: null }),

  pushOutput: (text, stream) => {
    if (!text) return
    const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const parts = clean.split('\n')
    const current = get().output
    const appended: OutputLine[] = parts
      .filter((p, idx) => p.length > 0 || idx < parts.length - 1)
      .map((p) => ({ id: ++outputSeq, text: p, stream }))
    let output = [...current, ...appended]
    if (output.length > MAX_OUTPUT_LINES) output = output.slice(output.length - MAX_OUTPUT_LINES)
    const found = parseProblems(parts)
    const problems = found.length ? [...get().problems.filter((p) => !found.some((f) => f.file === p.file && f.line === p.line)), ...found] : get().problems
    set({ output, problems: problems.slice(0, 800) })
  },

  clearOutput: () => set({ output: [], problems: [] }),
  setStatusText: (text) => set({ statusText: text }),

  projectOpenDialog: async () => {
    try {
      const info = await window.api.project.openDialog()
      if (info) {
        set({ project: info, tabs: [], activePath: null, sidebarView: 'files', sidebarVisible: true })
        await get().refreshTree()
        await get().refreshRecent()
        if (info.isSketch && info.sketchName) await get().openFile(`${info.sketchName}.ino`)
      }
    } catch (err) {
      get().showToast('error', (err as Error).message)
    }
  },

  projectOpen: async (root) => {
    try {
      const info = await window.api.project.open(root)
      set({ project: info, tabs: [], activePath: null })
      await get().refreshTree()
      await get().refreshRecent()
      if (info.isSketch && info.sketchName) await get().openFile(`${info.sketchName}.ino`)
    } catch (err) {
      get().showToast('error', (err as Error).message)
    }
  },

  projectClose: async () => {
    await window.api.project.close()
    set({ project: null, tree: [], tabs: [], activePath: null })
  },

  refreshTree: async () => {
    if (!get().project) {
      set({ tree: [] })
      return
    }
    try {
      const tree = await window.api.project.tree()
      set({ tree })
    } catch (err) {
      console.warn('[store] tree failed', err)
    }
  },

  refreshRecent: async () => {
    try {
      set({ recent: await window.api.project.recent() })
    } catch {
      /* ignore */
    }
  },

  openFile: async (path) => {
    const existing = get().tabs.find((t) => t.path === path)
    if (existing) {
      set({ activePath: path })
      // Re-read files that were changed on disk while the tab stayed clean.
      if (existing.content === existing.saved) {
        try {
          const content = await window.api.project.readFile(path)
          if (content !== existing.content) {
            set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content, saved: content } : t)) }))
          }
        } catch {
          /* ignore */
        }
      }
      return
    }
    try {
      const content = await window.api.project.readFile(path)
      const tab: EditorTab = { path, name: path.split('/').pop() || path, content, saved: content }
      set((s) => ({ tabs: [...s.tabs, tab], activePath: path }))
    } catch (err) {
      get().showToast('error', (err as Error).message)
    }
  },

  activateTab: (path) => set({ activePath: path }),

  updateTabContent: (path, content) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content } : t)) }))
    const settings = get().settings
    if (!settings.editor.autoSave) return
    if (!/\.(ino|pde|h|hpp|c|cpp|cc|cxx|hxx|txt|md|json|yml|yaml)$/i.test(path)) return
    const existing = autoSaveTimers.get(path)
    if (existing) clearTimeout(existing)
    autoSaveTimers.set(
      path,
      setTimeout(() => {
        autoSaveTimers.delete(path)
        const tab = get().tabs.find((t) => t.path === path)
        if (tab && tab.content !== tab.saved) void get().saveTab(path)
      }, Math.max(300, settings.editor.autoSaveDelay)),
    )
  },

  saveTab: async (path) => {
    const tab = get().tabs.find((t) => t.path === path)
    if (!tab) return false
    try {
      await window.api.project.writeFile(tab.path, tab.content)
      set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, saved: t.content } : t)) }))
      return true
    } catch (err) {
      get().showToast('error', get().t()('toast.saveFailed', { error: (err as Error).message }))
      return false
    }
  },

  saveActive: async () => {
    const active = get().activePath
    const tab = get().tabs.find((t) => t.path === active)
    if (!tab) {
      get().showToast('warning', get().t()('toast.noActiveFile'))
      return false
    }
    const ok = await get().saveTab(tab.path)
    if (ok) get().showToast('success', get().t()('toast.saved', { name: tab.name }))
    return ok
  },

  saveAll: async () => {
    for (const tab of get().tabs) {
      if (tab.content !== tab.saved) await get().saveTab(tab.path)
    }
    get().showToast('success', get().t()('common.saveAll'))
  },

  closeTab: async (path, force = false) => {
    const tab = get().tabs.find((t) => t.path === path)
    if (!tab) return
    const dirty = tab.content !== tab.saved
    const remove = () => {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.path === path)
        const tabs = s.tabs.filter((t) => t.path !== path)
        let activePath = s.activePath
        if (s.activePath === path) {
          activePath = tabs[Math.min(idx, tabs.length - 1)]?.path ?? null
        }
        return { tabs, activePath }
      })
    }
    if (!dirty || force) {
      remove()
      return
    }
    get().showConfirm({
      title: get().t()('tabs.unsaved'),
      message: `${tab.name}`,
      confirmLabel: get().t()('common.close'),
      danger: true,
      onConfirm: remove,
    })
  },

  reloadActiveIfClean: async () => {
    const path = get().activePath
    if (!path) return
    const tab = get().tabs.find((t) => t.path === path)
    if (!tab || tab.content !== tab.saved) return
    try {
      const content = await window.api.project.readFile(path)
      if (content !== tab.content) {
        set((s) => ({ tabs: s.tabs.map((t) => (t.path === path ? { ...t, content, saved: content } : t)) }))
      }
    } catch {
      /* file may have been removed */
    }
  },

  createEntry: async (kind, dirRel) => {
    const t = get().t()
    get().showPrompt({
      title: kind === 'file' ? t('explorer.newFile') : t('explorer.newFolder'),
      label: dirRel ? t('explorer.createIn', { dir: dirRel }) : undefined,
      value: '',
      placeholder: kind === 'file' ? 'main.ino' : 'lib',
      confirmLabel: t('common.create'),
      onSubmit: async (value) => {
        const name = value.trim()
        if (!name) return
        const rel = dirRel ? `${dirRel}/${name}` : name
        try {
          if (kind === 'file') await window.api.project.createFile(rel)
          else await window.api.project.createFolder(rel)
          await get().refreshTree()
          get().showToast('success', t('toast.created', { name: rel }))
          if (kind === 'file') await get().openFile(rel)
        } catch (err) {
          get().showToast('error', (err as Error).message)
        }
      },
    })
  },

  renameEntry: async (relPath, currentName) => {
    const t = get().t()
    get().showPrompt({
      title: t('common.rename'),
      value: currentName,
      confirmLabel: t('common.rename'),
      onSubmit: async (value) => {
        const name = value.trim()
        if (!name || name === currentName) return
        try {
          const newPath = await window.api.project.rename(relPath, name)
          await get().refreshTree()
          set((s) => ({
            tabs: s.tabs.map((tab) => (tab.path === relPath ? { ...tab, path: newPath, name } : tab)),
            activePath: s.activePath === relPath ? newPath : s.activePath,
          }))
          get().showToast('success', t('toast.renamed', { name }))
        } catch (err) {
          get().showToast('error', (err as Error).message)
        }
      },
    })
  },

  deleteEntry: async (relPath, name) => {
    const t = get().t()
    get().showConfirm({
      title: t('common.delete'),
      message: t('common.confirmDelete', { name }),
      confirmLabel: t('common.delete'),
      danger: true,
      onConfirm: async () => {
        try {
          await window.api.project.remove(relPath)
          await get().refreshTree()
          get().showToast('success', t('toast.deleted', { name }))
        } catch (err) {
          get().showToast('error', (err as Error).message)
        }
      },
    })
  },

  revealEntry: async (relPath) => {
    try {
      await window.api.project.reveal(relPath)
    } catch {
      /* ignore */
    }
  },

  loadArduinoData: async (force = false) => {
    try {
      const status = await window.api.arduino.status(force)
      set({ cliStatus: status })
      if (!status.installed) return
      const [boards, ports] = await Promise.all([window.api.arduino.boards(), window.api.arduino.ports()])
      set({ boards, ports })
      if (!get().settings.arduino.port) {
        const detected = ports.find((p) => p.fqbn)
        if (detected) get().setPort(detected.port)
      }
      const fqbn = get().settings.arduino.fqbn
      if (!fqbn && ports[0]?.fqbn) await get().setBoard(ports[0].fqbn)
      if (fqbn) {
        try {
          const details = await window.api.arduino.boardDetails(fqbn)
          set({ boardDetails: details })
        } catch {
          /* keep null */
        }
      }
    } catch (err) {
      console.warn('[store] arduino load failed', err)
    }
  },

  ensureCli: async () => {
    try {
      get().setStatusText(get().t()('common.loading'))
      const status = await window.api.arduino.ensureCli()
      set({ cliStatus: status })
      get().setStatusText('')
      if (status.installed) {
        get().showToast('success', get().t()('status.cliVersion', { version: status.version || '' }))
        await get().loadArduinoData(true)
      } else {
        get().showToast('error', status.error || 'arduino-cli')
      }
    } catch (err) {
      get().setStatusText('')
      get().showToast('error', (err as Error).message)
    }
  },

  refreshPorts: async () => {
    if (!get().cliStatus?.installed) return
    try {
      const ports = await window.api.arduino.ports()
      set({ ports })
    } catch {
      /* ignore */
    }
  },

  setBoard: async (fqbn) => {
    await get().updateSettings({ arduino: { fqbn, boardOptions: {} } })
    try {
      const details = await window.api.arduino.boardDetails(fqbn)
      const defaults: Record<string, string> = {}
      for (const option of details.options) {
        const selected = option.values.find((v) => v.selected)
        if (selected) defaults[option.id] = selected.value
      }
      set({ boardDetails: details })
      if (Object.keys(defaults).length) {
        await get().updateSettings({ arduino: { boardOptions: defaults } })
      }
    } catch {
      set({ boardDetails: null })
    }
  },

  setPort: (port) => {
    void get().updateSettings({ arduino: { port } })
    set((s) => ({ monitor: { ...s.monitor, port } }))
  },

  setBaud: async (baud) => {
    await get().updateSettings({ arduino: { baud } })
    set((s) => ({ monitor: { ...s.monitor, baud } }))
  },

  setBoardOption: async (optionId, value) => {
    const current = get().settings.arduino.boardOptions || {}
    await get().updateSettings({ arduino: { boardOptions: { ...current, [optionId]: value } } })
  },

  sketchDir: () => {
    const { project, activePath } = get()
    if (!project) return null
    if (activePath && activePath.toLowerCase().endsWith('.ino')) {
      const dir = posixDir(activePath)
      return dir ? joinAbs(project.root, dir) : project.root
    }
    return project.root
  },

  compile: async () => {
    const { project, settings, cliStatus } = get()
    const t = get().t()
    if (!project) {
      get().showToast('warning', t('toast.needProject'))
      return false
    }
    if (!cliStatus?.installed) {
      get().showToast('error', t('toast.cliMissing'))
      return false
    }
    if (!settings.arduino.fqbn) {
      get().showToast('warning', t('toast.needBoard'))
      return false
    }
    const sketchDir = get().sketchDir()
    if (!sketchDir) {
      get().showToast('warning', t('toast.needProject'))
      return false
    }
    set({ running: { kind: 'compile', title: t('status.compiling') }, lastCompile: null })
    try {
      const res = await window.api.arduino.compile({
        sketchDir,
        fqbn: settings.arduino.fqbn,
        boardOptions: settings.arduino.boardOptions,
        verbose: settings.arduino.compileVerbose,
      })
      set({ lastCompile: res })
      get().showToast(res.ok ? 'success' : 'error', res.ok ? t('toast.buildOk') : t('toast.buildFail'))
      return res.ok
    } catch (err) {
      get().pushOutput(`\n${(err as Error).message}\n`, 'system')
      get().showToast('error', (err as Error).message)
      return false
    } finally {
      set({ running: null })
      get().setStatusText('')
    }
  },

  upload: async () => {
    const { settings } = get()
    const t = get().t()
    if (!settings.arduino.port) {
      get().showToast('warning', t('toast.needPort'))
      get().setPanelView('serial')
      return
    }
    if (get().monitor.running) await get().stopMonitor()
    const ok = await get().compile()
    if (!ok) return
    const sketchDir = get().sketchDir()
    if (!sketchDir) return
    set({ running: { kind: 'upload', title: t('status.uploading') }, panelVisible: true, panelView: 'output' })
    try {
      await window.api.arduino.upload({
        sketchDir,
        fqbn: settings.arduino.fqbn,
        port: settings.arduino.port,
        boardOptions: settings.arduino.boardOptions,
        verbose: settings.arduino.compileVerbose,
      })
      get().showToast('success', t('toast.uploadOk'))
      const isSerialPort = /^COM\d+/i.test(settings.arduino.port)
      if (isSerialPort) {
        setTimeout(() => {
          void get().startMonitor().catch(() => undefined)
        }, 700)
      }
    } catch (err) {
      get().pushOutput(`\n${(err as Error).message}\n`, 'system')
      get().showToast('error', (err as Error).message)
    } finally {
      set({ running: null })
      get().setStatusText('')
    }
  },

  cancelRun: async () => {
    try {
      await window.api.arduino.cancel()
    } catch {
      /* ignore */
    }
  },

  toggleMonitor: async () => {
    if (get().monitor.running) await get().stopMonitor()
    else await get().startMonitor()
  },

  startMonitor: async () => {
    const { settings, monitor } = get()
    const t = get().t()
    const port = settings.arduino.port || monitor.port
    if (!port) {
      get().showToast('warning', t('serial.needPort'))
      return
    }
    set({ monitor: { ...monitor, buffer: monitor.buffer, port }, panelView: 'serial', panelVisible: true })
    try {
      await window.api.monitor.start(port, settings.arduino.baud)
      get().showToast('success', t('toast.monitorStarted', { port }))
    } catch (err) {
      get().showToast('error', (err as Error).message)
    }
  },

  stopMonitor: async () => {
    try {
      await window.api.monitor.stop()
      get().showToast('info', get().t()('toast.monitorStopped'))
    } catch {
      /* ignore */
    }
  },

  sendSerial: async (text) => {
    const t = get().t()
    const ending = get().settings.arduino.monitorLineEnding
    const suffix = ending === 'lf' ? '\n' : ending === 'crlf' ? '\r\n' : ''
    try {
      await window.api.monitor.send(text + suffix)
      set((s) => ({ monitor: { ...s.monitor, buffer: `${s.monitor.buffer}${text}\n` } }))
    } catch (err) {
      get().showToast('error', (err as Error).message || t('serial.sendUnsupported'))
    }
  },

  clearSerial: () => set((s) => ({ monitor: { ...s.monitor, buffer: '' } })),

  setSearchQuery: async (query) => {
    set({ searchQuery: query })
    if (query.trim().length < 2) {
      set({ searchResults: [], searchBusy: false })
      return
    }
    if (!get().project) {
      set({ searchResults: [] })
      return
    }
    set({ searchBusy: true })
    try {
      const results = await window.api.project.search(query)
      if (get().searchQuery === query) set({ searchResults: results, searchBusy: false })
    } catch {
      set({ searchBusy: false })
    }
  },

  runAction: (action) => {
    const store = get()
    switch (action) {
      case 'open-folder':
        void store.projectOpenDialog()
        break
      case 'new-sketch':
        set({ newSketchParent: store.project?.root || '', dialogs: { ...store.dialogs, newSketch: true } })
        break
      case 'save':
        void store.saveActive()
        break
      case 'save-all':
        void store.saveAll()
        break
      case 'settings':
        set({ dialogs: { ...store.dialogs, settings: true } })
        break
      case 'boards':
        set({ dialogs: { ...store.dialogs, boards: true } })
        break
      case 'libraries':
        set({ dialogs: { ...store.dialogs, libraries: true } })
        break
      case 'theme-editor':
        set({ dialogs: { ...store.dialogs, theme: true } })
        break
      case 'theme-light':
        void store.updateSettings({ theme: { mode: 'light', accent: '#2563eb' } })
        break
      case 'theme-dark':
        void store.updateSettings({ theme: { mode: 'dark', accent: '#4c9aff' } })
        break
      case 'search-project':
        set({ sidebarView: 'search', sidebarVisible: true })
        break
      case 'compile':
        void store.compile()
        break
      case 'upload':
        void store.upload()
        break
      case 'monitor':
      case 'plotter':
        void store.toggleMonitor()
        break
      case 'toggle-sidebar':
        set({ sidebarVisible: !store.sidebarVisible })
        break
      case 'toggle-panel':
        set({ panelVisible: !store.panelVisible })
        break
      case 'toggle-ai':
        set({ aiVisible: !store.aiVisible })
        break
      case 'zoom-in':
        void store.updateSettings({ theme: { uiScale: Math.min(1.6, (store.settings.theme.uiScale || 1) + 0.1) } })
        break
      case 'zoom-out':
        void store.updateSettings({ theme: { uiScale: Math.max(0.7, (store.settings.theme.uiScale || 1) - 0.1) } })
        break
      case 'zoom-reset':
        void store.updateSettings({ theme: { uiScale: 1 } })
        break
      case 'find':
      case 'replace':
      case 'format':
        window.dispatchEvent(new CustomEvent('zeduino:editor', { detail: { action } }))
        break
      default:
        break
    }
  },
}))
