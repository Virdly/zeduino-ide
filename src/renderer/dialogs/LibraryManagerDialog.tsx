import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  FileArchive,
  FolderOpen,
  Info,
  Library as LibraryIcon,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { LibraryInfo } from '../../shared/types'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'
import './dialogs.css'

/* ---------------------------------------------------------------- helpers */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function ProgressLine({ label }: { label: string }) {
  const progress = useApp((s) => s.progress)
  const percent = typeof progress?.percent === 'number' ? clamp(progress.percent, 0, 100) : null
  return (
    <div className="progress-line">
      <span className="spinner" />
      <span className="label">{progress?.detail || progress?.task || label}</span>
      {percent === null ? (
        <div className="progress indeterminate" />
      ) : (
        <div className="progress">
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  )
}

function useTopmostEscape(open: boolean, overlayRef: RefObject<HTMLDivElement>, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const state = useApp.getState()
      if (state.confirm || state.prompt || state.dialogs.newSketch) return
      const overlays = document.querySelectorAll('.dialog-overlay')
      const topmost = overlays[overlays.length - 1]
      if (topmost && topmost !== overlayRef.current) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, overlayRef, onClose])
}

/* ---------------------------------------------------------- installed tab */

function InstalledTab({
  libraries,
  loading,
  error,
  onChanged,
}: {
  libraries: LibraryInfo[]
  loading: boolean
  error: string
  onChanged: () => void
}) {
  const t = useT()
  const showConfirm = useApp((s) => s.showConfirm)
  const showToast = useApp((s) => s.showToast)
  const setPanelVisible = useApp((s) => s.setPanelVisible)
  const setPanelView = useApp((s) => s.setPanelView)
  const cliStatus = useApp((s) => s.cliStatus)
  const [query, setQuery] = useState('')
  const [busyName, setBusyName] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return libraries
    return libraries.filter(
      (library) =>
        library.name.toLowerCase().includes(needle) ||
        (library.author || '').toLowerCase().includes(needle) ||
        (library.sentence || '').toLowerCase().includes(needle),
    )
  }, [libraries, query])

  const locationLabel = (location?: string): string => {
    switch ((location || '').toLowerCase()) {
      case '':
        return t('dialog.libraries.location.unknown')
      case 'user':
        return t('dialog.libraries.location.user')
      case 'customfolders':
      case 'custom':
        return t('dialog.libraries.location.customFolders')
      case 'platform':
        return t('dialog.libraries.location.platform')
      case 'ide':
      case 'builtin':
        return t('dialog.libraries.location.ide')
      default:
        return t('dialog.libraries.location.other')
    }
  }

  const uninstall = (library: LibraryInfo) => {
    showConfirm({
      title: t('dialog.libraries.uninstallTitle'),
      message: t('dialog.libraries.uninstallMessage', { name: library.name }),
      confirmLabel: t('common.uninstall'),
      danger: true,
      onConfirm: async () => {
        setBusyName(library.name)
        setPanelVisible(true)
        setPanelView('output')
        try {
          await window.api.arduino.libUninstall(library.name)
          showToast('success', t('dialog.libraries.uninstallDone', { name: library.name }))
          onChanged()
        } catch (err) {
          showToast('error', (err as Error).message)
        } finally {
          setBusyName(null)
        }
      },
    })
  }

  return (
    <div className="dialog-pane">
      {!cliStatus?.installed && (
        <div className="notice warning" style={{ marginBottom: 12 }}>
          <Info size={14} />
          <span>
            {t('dialog.boards.cliMissing')}. {t('dialog.arduino.cliMissingHint')}
          </span>
        </div>
      )}

      {cliStatus?.installed && cliStatus.userDir && (
        <div className="field-hint" style={{ marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
          <FolderOpen size={12} />
          <span className="mono ellipsis" title={cliStatus.userDir}>
            {t('dialog.libraries.sketchbookBanner', { path: cliStatus.userDir })}
          </span>
        </div>
      )}

      <div className="field-row" style={{ marginBottom: 10 }}>
        <div className="search-input-wrap">
          <Search size={13} />
          <input
            className="input"
            value={query}
            placeholder={t('dialog.libraries.filter')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="badge">{filtered.length}</span>
        {(loading || busyName) && <span className="spinner" />}
      </div>

      {busyName && <ProgressLine label={t('dialog.libraries.installing')} />}
      {error && (
        <div className="field-hint error-text" style={{ marginBottom: 8 }}>
          {t('dialog.libraries.loadFailed')}: {error}
        </div>
      )}

      {!loading && filtered.length === 0 ? (
        <div className="pane-empty">
          <LibraryIcon size={22} />
          <span>{query ? t('common.nothingFound') : t('dialog.libraries.empty')}</span>
          {!query && <span className="field-hint">{t('dialog.libraries.emptyHint')}</span>}
        </div>
      ) : (
        <div className="list scroll fill">
          {filtered.map((library) => {
            const busy = busyName === library.name
            return (
              <div className="list-row" key={`${library.name}@${library.installedVersion || ''}`}>
                <div className="row-main">
                  <div className="row-title">
                    <span className="name">{library.name}</span>
                    <span className="badge success">
                      {library.installedVersion
                        ? t('dialog.libraries.version', { version: library.installedVersion })
                        : t('dialog.libraries.noVersion')}
                    </span>
                    {library.location && (
                      <span className="badge" title={t('dialog.libraries.location')}>
                        {locationLabel(library.location)}
                      </span>
                    )}
                  </div>
                  {library.author && (
                    <div className="row-sub">{t('dialog.libraries.author', { author: library.author })}</div>
                  )}
                  {library.sentence && (
                    <div className="row-sub" title={library.sentence}>
                      {library.sentence}
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  {library.location === 'customfolders' ? (
                    <button
                      type="button"
                      className="btn small"
                      disabled
                      title={t('dialog.libraries.externalHint')}
                    >
                      <Trash2 size={12} />
                      {t('common.uninstall')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn small danger"
                      disabled={busyName !== null}
                      onClick={() => uninstall(library)}
                    >
                      {busy ? <RefreshCw size={12} className="spin" /> : <Trash2 size={12} />}
                      {t('common.uninstall')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- search tab */

function SearchTab({ installed, onChanged }: { installed: LibraryInfo[]; onChanged: () => void }) {
  const t = useT()
  const showToast = useApp((s) => s.showToast)
  const setPanelVisible = useApp((s) => s.setPanelVisible)
  const setPanelView = useApp((s) => s.setPanelView)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LibraryInfo[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const seqRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const installedNames = useMemo(() => new Set(installed.map((library) => library.name)), [installed])

  const runSearch = useCallback(
    async (needle: string) => {
      const value = needle.trim()
      if (!value) {
        setResults(null)
        setSearching(false)
        return
      }
      const seq = ++seqRef.current
      setSearching(true)
      try {
        const list = await window.api.arduino.libSearch(value)
        if (seq === seqRef.current) setResults(list)
      } catch (err) {
        if (seq === seqRef.current) {
          setResults([])
          showToast('error', (err as Error).message)
        }
      } finally {
        if (seq === seqRef.current) setSearching(false)
      }
    },
    [showToast],
  )

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const value = query.trim()
    if (!value) {
      setResults(null)
      setSearching(false)
      return
    }
    timerRef.current = setTimeout(() => {
      void runSearch(value)
    }, 400)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, runSearch])

  const install = async (library: LibraryInfo) => {
    setBusyName(library.name)
    setPanelVisible(true)
    setPanelView('output')
    try {
      await window.api.arduino.libInstall(library.name)
      showToast('success', t('dialog.libraries.installDone', { name: library.name }))
      onChanged()
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusyName(null)
    }
  }

  return (
    <div className="dialog-pane">
      <form
        className="field-row"
        style={{ marginBottom: 8 }}
        onSubmit={(event) => {
          event.preventDefault()
          if (timerRef.current) clearTimeout(timerRef.current)
          void runSearch(query)
        }}
      >
        <div className="search-input-wrap">
          <Search size={13} />
          <input
            className="input"
            value={query}
            placeholder={t('dialog.libraries.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className="btn" disabled={searching}>
          {searching ? <RefreshCw size={13} className="spin" /> : <Search size={13} />}
          {t('dialog.libraries.search')}
        </button>
      </form>
      <div className="field-hint" style={{ marginBottom: 10 }}>{t('dialog.libraries.searchHint')}</div>

      {busyName && <ProgressLine label={t('dialog.libraries.installing')} />}
      {searching && <ProgressLine label={t('dialog.libraries.searching')} />}

      {results === null && !busyName && (
        <div className="pane-empty">
          <Search size={22} />
          <span>{t('dialog.libraries.searchIdle')}</span>
        </div>
      )}

      {results !== null && results.length === 0 && !searching && (
        <div className="pane-empty">
          <span>{t('dialog.libraries.noResults')}</span>
        </div>
      )}

      {results !== null && results.length > 0 && (
        <div className="list scroll fill">
          {results.map((library) => {
            const already = installedNames.has(library.name)
            const busy = busyName === library.name
            return (
              <div className="list-row" key={library.name}>
                <div className="row-main">
                  <div className="row-title">
                    <span className="name">{library.name}</span>
                    {library.availableVersion && (
                      <span className="badge">
                        {t('dialog.libraries.available', { version: library.availableVersion })}
                      </span>
                    )}
                    {already && <span className="badge success">{t('dialog.libraries.installed')}</span>}
                  </div>
                  {library.author && (
                    <div className="row-sub">{t('dialog.libraries.author', { author: library.author })}</div>
                  )}
                  {library.sentence && (
                    <div className="row-sub" title={library.sentence}>
                      {library.sentence}
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={already || busyName !== null}
                    onClick={() => void install(library)}
                  >
                    {busy ? <RefreshCw size={12} className="spin" /> : <Upload size={12} />}
                    {busy ? t('dialog.libraries.installing') : t('common.install')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ folders tab */

function FoldersTab({ onChanged }: { onChanged: () => void }) {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const cliStatus = useApp((s) => s.cliStatus)
  const updateSettings = useApp((s) => s.updateSettings)
  const showToast = useApp((s) => s.showToast)
  const setPanelVisible = useApp((s) => s.setPanelVisible)
  const setPanelView = useApp((s) => s.setPanelView)
  const [zipBusy, setZipBusy] = useState(false)

  const installZip = async () => {
    setZipBusy(true)
    setPanelVisible(true)
    setPanelView('output')
    try {
      const result = (await window.api.arduino.libInstallZip()) as LibraryInfo | null
      if (result) {
        showToast('success', t('dialog.libraries.zipDone'))
        onChanged()
      }
    } catch (err) {
      showToast('error', (err as Error).message || t('dialog.libraries.zipFailed'))
    } finally {
      setZipBusy(false)
    }
  }

  const addLibraryDir = async () => {
    try {
      const dir = await window.api.app.pickFolder(t('dialog.libraries.pickDir'))
      if (!dir) return
      const dirs = settings.arduino.libraryDirs
      if (dirs.includes(dir)) return
      await updateSettings({ arduino: { libraryDirs: [...dirs, dir] } })
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  const removeLibraryDir = async (dir: string) => {
    try {
      await updateSettings({ arduino: { libraryDirs: settings.arduino.libraryDirs.filter((item) => item !== dir) } })
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  const configuredSketchbook = settings.arduino.sketchbookDir
  const fallbackSketchbook = cliStatus?.userDir || ''

  return (
    <div className="dialog-pane">
      <div className="section-card">
        <div className="section-title">
          <FileArchive size={13} />
          {t('dialog.libraries.zipTitle')}
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={zipBusy} onClick={() => void installZip()}>
            {zipBusy ? <RefreshCw size={13} className="spin" /> : <FileArchive size={13} />}
            {t('dialog.libraries.installZip')}
          </button>
          {zipBusy && <span className="field-hint">{t('dialog.libraries.installing')}</span>}
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>{t('dialog.libraries.zipHint')}</div>
        {zipBusy && <ProgressLine label={t('dialog.libraries.installing')} />}
      </div>

      <div className="section">
        <div className="section-title">
          <FolderOpen size={13} />
          {t('dialog.libraries.dirsTitle')}
        </div>
        <div className="chip-list">
          {settings.arduino.libraryDirs.length === 0 && (
            <span className="field-hint">{t('dialog.libraries.noDirs')}</span>
          )}
          {settings.arduino.libraryDirs.map((dir) => (
            <span className="chip" key={dir}>
              <FolderOpen size={11} />
              <span className="chip-path" title={dir}>
                {dir}
              </span>
              <button
                type="button"
                title={t('common.remove')}
                aria-label={t('common.remove')}
                onClick={() => void removeLibraryDir(dir)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="field-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn small ghost" onClick={() => void addLibraryDir()}>
            <FolderOpen size={12} />
            {t('dialog.libraries.addFolder')}
          </button>
        </div>
        <span className="field-hint">{t('dialog.libraries.dirsHint')}</span>
      </div>

      <div className="section">
        <div className="field-label">{t('dialog.libraries.sketchbook')}</div>
        {configuredSketchbook ? (
          <span className="field-value mono" title={configuredSketchbook}>
            {configuredSketchbook}
          </span>
        ) : fallbackSketchbook ? (
          <span className="field-value muted">{t('dialog.libraries.sketchbookFallback', { path: fallbackSketchbook })}</span>
        ) : (
          <span className="field-value muted">{t('common.none')}</span>
        )}
        <span className="field-hint">{t('dialog.libraries.sketchbookHint')}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ dialog */

type LibraryTab = 'installed' | 'search' | 'folders'

const TABS: LibraryTab[] = ['installed', 'search', 'folders']

export function LibraryManagerDialog() {
  const t = useT()
  const open = useApp((s) => s.dialogs.libraries)
  const setDialog = useApp((s) => s.setDialog)
  const cliStatus = useApp((s) => s.cliStatus)

  const [tab, setTab] = useState<LibraryTab>('installed')
  const [libraries, setLibraries] = useState<LibraryInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const overlayRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setDialog('libraries', false), [setDialog])
  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  useTopmostEscape(open, overlayRef, close)

  useEffect(() => {
    if (!open) return
    if (!cliStatus?.installed) {
      setLibraries([])
      setLoadError('')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError('')
    window.api.arduino
      .libraries()
      .then((list) => {
        if (!cancelled) setLibraries(list)
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError((err as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, cliStatus?.installed, reloadKey])

  if (!open) return null

  return (
    <div
      className="dialog-overlay"
      ref={overlayRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="dialog wide manager-dialog" role="dialog" aria-modal="true" aria-label={t('dialog.libraries')}>
        <div className="dialog-header">
          <LibraryIcon size={16} style={{ color: 'var(--text-muted)' }} />
          <span className="dialog-title">{t('dialog.libraries')}</span>
          {libraries.length > 0 && <span className="badge">{libraries.length}</span>}
          {loading && <span className="spinner" />}
          <button type="button" className="icon-btn" title={t('dialog.libraries.refresh')} onClick={reload}>
            <RefreshCw size={14} />
          </button>
          <button type="button" className="icon-btn dialog-close" title={t('common.close')} onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="tab-strip" role="tablist">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {t(`dialog.libraries.tab.${id}`)}
            </button>
          ))}
        </div>

        <div className="dialog-body manager-body">
          {tab === 'installed' && (
            <InstalledTab libraries={libraries} loading={loading} error={loadError} onChanged={reload} />
          )}
          {tab === 'search' && <SearchTab installed={libraries} onChanged={reload} />}
          {tab === 'folders' && <FoldersTab onChanged={reload} />}
        </div>

        <div className="dialog-footer">
          <div className="spacer" />
          <button type="button" className="btn" onClick={close}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
