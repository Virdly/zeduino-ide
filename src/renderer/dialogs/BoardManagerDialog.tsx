import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Check,
  Cpu,
  Download,
  Info,
  Link as LinkIcon,
  Package,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import type { BoardEntry, CoreInfo } from '../../shared/types'
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

/* ------------------------------------------------------------- boards tab */

function BoardsTab() {
  const t = useT()
  const boards = useApp((s) => s.boards)
  const boardDetails = useApp((s) => s.boardDetails)
  const settings = useApp((s) => s.settings)
  const cliStatus = useApp((s) => s.cliStatus)
  const setBoard = useApp((s) => s.setBoard)
  const setBoardOption = useApp((s) => s.setBoardOption)
  const showToast = useApp((s) => s.showToast)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return boards
    return boards.filter(
      (board) =>
        board.name.toLowerCase().includes(needle) ||
        board.fqbn.toLowerCase().includes(needle) ||
        (board.platform || '').toLowerCase().includes(needle),
    )
  }, [boards, query])

  const currentFqbn = settings.arduino.fqbn
  const options = boardDetails && boardDetails.fqbn === currentFqbn ? boardDetails.options : []

  const selectBoard = async (board: BoardEntry) => {
    setBusy(true)
    try {
      await setBoard(board.fqbn)
      showToast('success', t('dialog.boards.boardSelected', { name: board.name }))
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const selectOption = async (optionId: string, value: string) => {
    setBusy(true)
    try {
      await setBoardOption(optionId, value)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
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

      {options.length > 0 && (
        <div className="section-card">
          <div className="section-title">
            <SlidersHorizontal size={13} />
            {t('dialog.boards.boardOptions')}
          </div>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            {t('dialog.boards.boardOptionsHint', { name: boardDetails?.name || currentFqbn })}
          </div>
          {options.map((option) => {
            const selected =
              settings.arduino.boardOptions?.[option.id] ||
              option.values.find((value) => value.selected)?.value ||
              option.values[0]?.value ||
              ''
            return (
              <div className="field" key={option.id} style={{ marginBottom: 10 }}>
                <label className="field-label">{option.label}</label>
                <select
                  className="select"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => void selectOption(option.id, e.target.value)}
                >
                  {option.values.map((value) => (
                    <option value={value.value} key={value.value}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}

      <div className="field-row" style={{ marginBottom: 10 }}>
        <div className="search-input-wrap">
          <Search size={13} />
          <input
            className="input"
            value={query}
            placeholder={t('dialog.boards.searchBoards')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="badge">{filtered.length}</span>
      </div>

      {busy && <ProgressLine label={t('dialog.boards.busyBoard')} />}

      {filtered.length === 0 ? (
        <div className="pane-empty">
          <Cpu size={22} />
          <span>{t('dialog.boards.noBoards')}</span>
          <span className="field-hint">{t('dialog.boards.noBoardsHint')}</span>
        </div>
      ) : (
        <div className="list scroll fill">
          {filtered.map((board) => {
            const selected = board.fqbn === currentFqbn
            return (
              <div className={`list-row ${selected ? 'selected' : ''}`} key={board.fqbn}>
                <div className="row-main">
                  <div className="row-title">
                    <span className="name">{board.name}</span>
                    {selected && <span className="badge accent">{t('dialog.boards.selected')}</span>}
                  </div>
                  <div className="row-sub mono">{board.fqbn}</div>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className={`btn small ${selected ? 'ghost' : 'primary'}`}
                    disabled={selected || busy}
                    onClick={() => void selectBoard(board)}
                  >
                    {selected ? <Check size={12} /> : null}
                    {t('dialog.boards.select')}
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

/* -------------------------------------------------------------- cores tab */

function CoresTab() {
  const t = useT()
  const cliStatus = useApp((s) => s.cliStatus)
  const showToast = useApp((s) => s.showToast)
  const showConfirm = useApp((s) => s.showConfirm)
  const loadArduinoData = useApp((s) => s.loadArduinoData)
  const setPanelVisible = useApp((s) => s.setPanelVisible)
  const setPanelView = useApp((s) => s.setPanelView)

  const [cores, setCores] = useState<CoreInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CoreInfo[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!cliStatus?.installed) {
      setCores([])
      setLoadError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError('')
    window.api.arduino
      .cores()
      .then((list) => {
        if (!cancelled) setCores(list)
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
  }, [cliStatus?.installed, reloadKey])

  const runSearch = async () => {
    const needle = query.trim()
    if (!needle) {
      setResults(null)
      return
    }
    setSearching(true)
    try {
      setResults(await window.api.arduino.coreSearch(needle))
    } catch (err) {
      setResults([])
      showToast('error', (err as Error).message)
    } finally {
      setSearching(false)
    }
  }

  const installCore = async (core: CoreInfo) => {
    setBusyId(core.id)
    setPanelVisible(true)
    setPanelView('output')
    try {
      await window.api.arduino.coreInstall(core.id)
      showToast('success', t('dialog.boards.coreInstalled', { id: core.id }))
      setReloadKey((value) => value + 1)
      await loadArduinoData(true)
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const uninstallCore = (core: CoreInfo) => {
    showConfirm({
      title: t('dialog.boards.uninstallTitle'),
      message: t('dialog.boards.uninstallMessage', { id: core.name || core.id }),
      confirmLabel: t('common.uninstall'),
      danger: true,
      onConfirm: async () => {
        setBusyId(core.id)
        setPanelVisible(true)
        setPanelView('output')
        try {
          await window.api.arduino.coreUninstall(core.id)
          showToast('success', t('dialog.boards.coreUninstalled', { id: core.id }))
          setReloadKey((value) => value + 1)
          await loadArduinoData(true)
        } catch (err) {
          showToast('error', (err as Error).message)
        } finally {
          setBusyId(null)
        }
      },
    })
  }

  const installedIds = useMemo(() => new Set(cores.map((core) => core.id)), [cores])

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

      <div className="section-title">
        <Package size={13} />
        {t('dialog.boards.coresInstalled')}
        {loading && <span className="spinner" />}
      </div>

      {loadError && (
        <div className="field-hint error-text" style={{ marginBottom: 8 }}>
          {t('dialog.boards.loadCoresFailed')}: {loadError}
        </div>
      )}
      {busyId && <ProgressLine label={t('dialog.boards.installingCore')} />}

      {!loading && cores.length === 0 ? (
        <div className="pane-empty" style={{ padding: '16px 12px' }}>
          <span>{t('dialog.boards.coresEmpty')}</span>
          <span className="field-hint">{t('dialog.boards.coresEmptyHint')}</span>
        </div>
      ) : (
        <div className="list scroll" style={{ marginBottom: 16 }}>
          {cores.map((core) => {
            const busy = busyId === core.id
            return (
              <div className="list-row" key={core.id}>
                <div className="row-main">
                  <div className="row-title">
                    <span className="name">{core.name || core.id}</span>
                    {core.installedVersion && (
                      <span className="badge success">
                        {t('dialog.boards.version', { version: core.installedVersion })}
                      </span>
                    )}
                    {core.latestVersion && core.latestVersion !== core.installedVersion && (
                      <span className="badge">
                        {t('dialog.boards.latestVersion', { version: core.latestVersion })}
                      </span>
                    )}
                  </div>
                  <div className="row-sub mono">{core.id}</div>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busyId !== null}
                    onClick={() => uninstallCore(core)}
                  >
                    {busy ? <RefreshCw size={12} className="spin" /> : <Trash2 size={12} />}
                    {t('dialog.boards.uninstallCore')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="section-title">
        <Search size={13} />
        {t('dialog.boards.search')}
      </div>
      <form
        className="field-row"
        style={{ marginBottom: 8 }}
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch()
        }}
      >
        <div className="search-input-wrap">
          <Search size={13} />
          <input
            className="input"
            value={query}
            placeholder={t('dialog.boards.searchCorePlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="submit" className="btn" disabled={searching}>
          {searching ? <RefreshCw size={13} className="spin" /> : <Search size={13} />}
          {t('dialog.boards.search')}
        </button>
      </form>
      <div className="field-hint" style={{ marginBottom: 8 }}>{t('dialog.boards.searchHint')}</div>

      {searching && <ProgressLine label={t('common.loading')} />}

      {results !== null &&
        (results.length === 0 ? (
          <div className="pane-empty" style={{ padding: '14px 12px' }}>
            <span>{t('dialog.boards.noSearchResults')}</span>
          </div>
        ) : (
          <div className="list scroll">
            {results.map((core) => {
              const already = installedIds.has(core.id)
              const busy = busyId === core.id
              return (
                <div className="list-row" key={core.id}>
                  <div className="row-main">
                    <div className="row-title">
                      <span className="name">{core.name || core.id}</span>
                      {core.latestVersion && (
                        <span className="badge">
                          {t('dialog.boards.latestVersion', { version: core.latestVersion })}
                        </span>
                      )}
                      {already && <span className="badge success">{t('common.installed')}</span>}
                    </div>
                    <div className="row-sub mono">{core.id}</div>
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={already || busyId !== null}
                      onClick={() => void installCore(core)}
                    >
                      {busy ? <RefreshCw size={12} className="spin" /> : <Download size={12} />}
                      {busy ? t('dialog.boards.installingCore') : t('dialog.boards.installCore')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}

/* --------------------------------------------------------------- urls tab */

function UrlsTab() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const loadArduinoData = useApp((s) => s.loadArduinoData)
  const showToast = useApp((s) => s.showToast)
  const setPanelVisible = useApp((s) => s.setPanelVisible)
  const setPanelView = useApp((s) => s.setPanelView)

  const [urls, setUrls] = useState(settings.arduino.additionalUrls.join('\n'))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setUrls(settings.arduino.additionalUrls.join('\n'))
  }, [settings.arduino.additionalUrls])

  const apply = async () => {
    const lines = urls
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const invalid = lines.find((line) => !/^https?:\/\/\S+$/i.test(line))
    if (invalid) {
      setError(t('dialog.boards.urlsInvalid', { url: invalid }))
      return
    }
    setError('')
    setBusy(true)
    setPanelVisible(true)
    setPanelView('output')
    try {
      await updateSettings({ arduino: { additionalUrls: lines } })
      await window.api.arduino.updateIndex()
      await loadArduinoData(true)
      showToast('success', t('dialog.boards.urlsApplied'))
    } catch (err) {
      showToast('error', (err as Error).message || t('dialog.arduino.indexFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-pane">
      <div className="field">
        <label className="field-label">{t('dialog.boards.urlsTitle')}</label>
        <textarea
          className="textarea"
          rows={8}
          spellCheck={false}
          value={urls}
          placeholder={t('dialog.boards.urlsPlaceholder')}
          onChange={(e) => {
            setUrls(e.target.value)
            if (error) setError('')
          }}
        />
        {error ? (
          <span className="field-hint error-text">{error}</span>
        ) : (
          <span className="field-hint">{t('dialog.boards.urlsHint')}</span>
        )}
      </div>
      <div className="field-row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void apply()}>
          {busy ? <RefreshCw size={13} className="spin" /> : <LinkIcon size={13} />}
          {t('dialog.boards.urlsApply')}
        </button>
      </div>
      {busy && <ProgressLine label={t('dialog.boards.indexing')} />}
      <div className="notice">
        <Info size={14} />
        <span>{t('dialog.arduino.urlsHint')}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ dialog */

type ManagerTab = 'boards' | 'cores' | 'urls'

const TABS: ManagerTab[] = ['boards', 'cores', 'urls']

export function BoardManagerDialog() {
  const t = useT()
  const open = useApp((s) => s.dialogs.boards)
  const setDialog = useApp((s) => s.setDialog)
  const cliStatus = useApp((s) => s.cliStatus)
  const boards = useApp((s) => s.boards)
  const loadArduinoData = useApp((s) => s.loadArduinoData)
  const showToast = useApp((s) => s.showToast)
  const setPanelVisible = useApp((s) => s.setPanelVisible)
  const setPanelView = useApp((s) => s.setPanelView)
  const [tab, setTab] = useState<ManagerTab>('boards')
  const [installing, setInstalling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setDialog('boards', false), [setDialog])

  useTopmostEscape(open, overlayRef, close)

  const installCli = async () => {
    setInstalling(true)
    setPanelVisible(true)
    setPanelView('output')
    try {
      const status = await window.api.arduino.ensureCli()
      await loadArduinoData(true)
      if (status.installed) {
        showToast('success', t('dialog.arduino.cliInstalledToast', { version: status.version || '' }))
      } else {
        showToast('error', status.error || t('dialog.arduino.cliFailed'))
      }
    } catch (err) {
      showToast('error', (err as Error).message || t('dialog.arduino.cliFailed'))
    } finally {
      setInstalling(false)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await loadArduinoData(true)
    } finally {
      setRefreshing(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="dialog-overlay"
      ref={overlayRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="dialog wide manager-dialog" role="dialog" aria-modal="true" aria-label={t('dialog.boards')}>
        <div className="dialog-header">
          <Cpu size={16} style={{ color: 'var(--text-muted)' }} />
          <span className="dialog-title">{t('dialog.boards')}</span>
          {cliStatus?.installed ? (
            <span className="badge success">
              {t('dialog.boards.cliVersion', { version: cliStatus.version || '' })}
            </span>
          ) : (
            <>
              <span className="badge error">{t('dialog.boards.cliMissing')}</span>
              <button
                type="button"
                className="btn small primary"
                disabled={installing}
                onClick={() => void installCli()}
              >
                {installing ? <RefreshCw size={12} className="spin" /> : <Download size={12} />}
                {installing ? t('dialog.boards.cliInstalling') : t('common.install')}
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-btn"
            title={t('common.refresh')}
            disabled={refreshing || !cliStatus?.installed}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
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
              {t(`dialog.boards.tab.${id}`)}
              {id === 'boards' && boards.length > 0 && <span className="badge">{boards.length}</span>}
            </button>
          ))}
        </div>

        <div className="dialog-body manager-body">
          {tab === 'boards' && <BoardsTab />}
          {tab === 'cores' && <CoresTab />}
          {tab === 'urls' && <UrlsTab />}
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
