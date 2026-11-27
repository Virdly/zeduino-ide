import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  Bot,
  Check,
  Cpu,
  Eye,
  EyeOff,
  FolderOpen,
  Keyboard,
  Languages,
  Moon,
  Paintbrush,
  Palette,
  Plug,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Type,
  X,
} from 'lucide-react'
import { DARK_COLORS, LIGHT_COLORS } from '../../shared/theme'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import type { EditorSettings } from '../../shared/types'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'
import './dialogs.css'

/* ---------------------------------------------------------------- helpers */

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 921600]

const ACCENT_PRESETS = [
  '#4c9aff',
  '#2563eb',
  '#7c3aed',
  '#a855f7',
  '#db2777',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#94a3b8',
]

type SettingsTab = 'general' | 'editor' | 'arduino' | 'ai' | 'theme'

const TAB_ICONS: Record<SettingsTab, ReactNode> = {
  general: <SlidersHorizontal size={15} />,
  editor: <Type size={15} />,
  arduino: <Cpu size={15} />,
  ai: <Bot size={15} />,
  theme: <Palette size={15} />,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isHex6(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
}

/** Presets carry a full color map: an empty object cannot clear merged settings. */
function themePreset(mode: 'dark' | 'light'): Record<string, unknown> {
  return { theme: { mode, colors: mode === 'light' ? { ...LIGHT_COLORS } : { ...DARK_COLORS } } }
}

function useApplySettings() {
  const updateSettings = useApp((s) => s.updateSettings)
  const showToast = useApp((s) => s.showToast)
  return useCallback(
    (patch: Record<string, unknown>) => {
      void updateSettings(patch).catch((err: unknown) => {
        showToast('error', (err as Error).message)
      })
    },
    [updateSettings, showToast],
  )
}

/** Local draft for text fields, committed on a short debounce (and on demand). */
function useDraft(value: string, commit: (next: string) => void, delay = 350) {
  const commitRef = useRef(commit)
  commitRef.current = commit
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const syncedRef = useRef(value)

  useEffect(() => {
    if (value !== syncedRef.current) {
      syncedRef.current = value
      setDraft(value)
    }
  }, [value])

  const flush = useCallback(() => {
    if (draftRef.current === syncedRef.current) return
    syncedRef.current = draftRef.current
    commitRef.current(draftRef.current)
  }, [])

  useEffect(() => {
    if (draft === syncedRef.current) return
    const timer = setTimeout(flush, delay)
    return () => clearTimeout(timer)
  }, [draft, delay, flush])

  useEffect(() => () => flush(), [flush])

  return { draft, setDraft, flush }
}

/* ------------------------------------------------------------- primitives */

interface NumberFieldProps {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
}

function NumberField({ label, hint, value, min, max, step = 1, disabled, onChange }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const next = clamp(Math.round(parsed), min, max)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        className="input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            e.currentTarget.blur()
          }
        }}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

interface SliderFieldProps {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format?: (value: number) => string
}

function SliderField({ label, hint, value, min, max, step, onChange, format }: SliderFieldProps) {
  const [draft, setDraft] = useState(value)
  const pendingRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(onChange)
  commitRef.current = onChange

  useEffect(() => {
    if (pendingRef.current === null) setDraft(value)
  }, [value])

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current === null) return
    const next = pendingRef.current
    pendingRef.current = null
    commitRef.current(next)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const change = (next: number) => {
    setDraft(next)
    pendingRef.current = next
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 180)
  }

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="slider-row">
        <input
          className="range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => change(Number(e.target.value))}
          onPointerUp={flush}
          onKeyUp={flush}
          onBlur={flush}
        />
        <span className="slider-value">{format ? format(draft) : String(draft)}</span>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="switch-row">
      <div className="grow">
        <div className="field-label">{label}</div>
        {hint && <div className="field-hint">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}

function AccentPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const t = useT()
  const safe = isHex6(value) ? value : '#4c9aff'
  return (
    <div className="swatch-row">
      {ACCENT_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          className={`accent-dot ${value.toLowerCase() === color ? 'active' : ''}`}
          style={{ background: color }}
          title={color}
          aria-label={color}
          onClick={() => onChange(color)}
        />
      ))}
      <input
        className="swatch-input"
        type="color"
        value={safe}
        title={t('dialog.general.accent')}
        aria-label={t('dialog.general.accent')}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
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

/* ------------------------------------------------------------ general tab */

function GeneralTab() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const setDialog = useApp((s) => s.setDialog)
  const apply = useApplySettings()
  const mode = settings.theme.mode

  return (
    <div>
      <div className="section">
        <div className="section-title">
          <Languages size={13} />
          {t('dialog.general.interface')}
        </div>
        <div className="field">
          <span className="field-label">{t('dialog.general.language')}</span>
          <div className="segmented">
            <button
              type="button"
              className={settings.language === 'ru' ? 'active' : ''}
              onClick={() => apply({ language: 'ru' })}
            >
              {t('dialog.language.ru')}
            </button>
            <button
              type="button"
              className={settings.language === 'en' ? 'active' : ''}
              onClick={() => apply({ language: 'en' })}
            >
              {t('dialog.language.en')}
            </button>
          </div>
          <span className="field-hint">{t('dialog.general.languageHint')}</span>
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          <Palette size={13} />
          {t('dialog.general.appearance')}
        </div>
        <div className="field">
          <span className="field-label">{t('dialog.general.themeMode')}</span>
          <div className="segmented">
            <button
              type="button"
              className={mode === 'dark' ? 'active' : ''}
              onClick={() => apply(themePreset('dark'))}
            >
              <Moon size={12} />
              {t('dialog.mode.dark')}
            </button>
            <button
              type="button"
              className={mode === 'light' ? 'active' : ''}
              onClick={() => apply(themePreset('light'))}
            >
              <Sun size={12} />
              {t('dialog.mode.light')}
            </button>
            <button
              type="button"
              className={mode === 'custom' ? 'active' : ''}
              onClick={() => apply({ theme: { mode: 'custom' } })}
            >
              <Palette size={12} />
              {t('dialog.mode.custom')}
            </button>
          </div>
          <span className="field-hint">{t('dialog.general.themeModeHint')}</span>
        </div>
        <div className="field">
          <span className="field-label">{t('dialog.general.accent')}</span>
          <AccentPicker value={settings.theme.accent} onChange={(accent) => apply({ theme: { accent } })} />
          <span className="field-hint">{t('dialog.general.accentHint')}</span>
        </div>
        <SliderField
          label={t('dialog.general.scale')}
          hint={t('dialog.general.scaleHint')}
          value={settings.theme.uiScale}
          min={0.7}
          max={1.5}
          step={0.05}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(uiScale) => apply({ theme: { uiScale } })}
        />
      </div>

      <div className="section-card row" style={{ gap: 12 }}>
        <div className="grow">
          <div className="field-label">{t('dialog.general.openThemeEditor')}</div>
          <div className="field-hint">{t('dialog.general.openThemeEditorHint')}</div>
        </div>
        <button type="button" className="btn" onClick={() => setDialog('theme', true)}>
          <Paintbrush size={13} />
          {t('common.open')}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- editor tab */

function EditorTab() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const apply = useApplySettings()
  const editor = settings.editor

  const patch = useCallback((value: Partial<EditorSettings>) => apply({ editor: value }), [apply])

  const fontFamily = useDraft(
    editor.fontFamily,
    (next) => patch({ fontFamily: next.trim() || DEFAULT_SETTINGS.editor.fontFamily }),
    400,
  )

  return (
    <div>
      <div className="section">
        <div className="section-title">
          <Type size={13} />
          {t('dialog.editor.typography')}
        </div>
        <NumberField
          label={t('dialog.editor.fontSize')}
          hint={t('dialog.editor.fontSizeHint')}
          value={editor.fontSize}
          min={10}
          max={28}
          onChange={(fontSize) => patch({ fontSize })}
        />
        <div className="field">
          <label className="field-label">{t('dialog.editor.fontFamily')}</label>
          <input
            className="input mono"
            value={fontFamily.draft}
            spellCheck={false}
            onChange={(e) => fontFamily.setDraft(e.target.value)}
            onBlur={fontFamily.flush}
          />
          <span className="field-hint">{t('dialog.editor.fontFamilyHint')}</span>
        </div>
        <NumberField
          label={t('dialog.editor.tabSize')}
          hint={t('dialog.editor.tabSizeHint')}
          value={editor.tabSize}
          min={1}
          max={8}
          onChange={(tabSize) => patch({ tabSize })}
        />
      </div>

      <div className="section">
        <div className="section-title">
          <Keyboard size={13} />
          {t('dialog.editor.behavior')}
        </div>
        <SwitchRow
          label={t('dialog.editor.wordWrap')}
          checked={editor.wordWrap}
          onChange={(wordWrap) => patch({ wordWrap })}
        />
        <SwitchRow
          label={t('dialog.editor.lineNumbers')}
          checked={editor.lineNumbers}
          onChange={(lineNumbers) => patch({ lineNumbers })}
        />
        <SwitchRow
          label={t('dialog.editor.autocomplete')}
          checked={editor.autocomplete}
          onChange={(autocomplete) => patch({ autocomplete })}
        />
        <SwitchRow
          label={t('dialog.editor.autoSave')}
          hint={t('dialog.editor.autoSaveHint')}
          checked={editor.autoSave}
          onChange={(autoSave) => patch({ autoSave })}
        />
        <NumberField
          label={t('dialog.editor.autoSaveDelay')}
          hint={t('dialog.editor.autoSaveDelayHint')}
          value={editor.autoSaveDelay}
          min={300}
          max={10_000}
          step={50}
          disabled={!editor.autoSave}
          onChange={(autoSaveDelay) => patch({ autoSaveDelay })}
        />
        <SwitchRow
          label={t('dialog.editor.highlightActiveLine')}
          checked={editor.highlightActiveLine}
          onChange={(highlightActiveLine) => patch({ highlightActiveLine })}
        />
        <SwitchRow
          label={t('dialog.editor.bracketMatching')}
          checked={editor.bracketMatching}
          onChange={(bracketMatching) => patch({ bracketMatching })}
        />
      </div>

      <div className="section">
        <div className="section-title">{t('dialog.editor.preview')}</div>
        <div
          className="settings-preview"
          style={{
            fontFamily: editor.fontFamily || DEFAULT_SETTINGS.editor.fontFamily,
            fontSize: editor.fontSize,
          }}
        >
          {t('dialog.editor.previewCode')}
        </div>
        <span className="field-hint">{t('dialog.editor.previewHint')}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ arduino tab */

function ArduinoTab() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const cliStatus = useApp((s) => s.cliStatus)
  const loadArduinoData = useApp((s) => s.loadArduinoData)
  const setBaud = useApp((s) => s.setBaud)
  const showToast = useApp((s) => s.showToast)
  const showConfirm = useApp((s) => s.showConfirm)
  const setPanelVisible = useApp((s) => s.setPanelVisible)
  const setPanelView = useApp((s) => s.setPanelView)
  const updateSettings = useApp((s) => s.updateSettings)
  const apply = useApplySettings()

  const [busy, setBusy] = useState<'cli' | 'path' | 'index' | null>(null)
  const [urls, setUrls] = useState(settings.arduino.additionalUrls.join('\n'))
  const [urlsError, setUrlsError] = useState('')
  const installed = !!cliStatus?.installed

  useEffect(() => {
    setUrls(settings.arduino.additionalUrls.join('\n'))
  }, [settings.arduino.additionalUrls])

  const installCli = async () => {
    setBusy('cli')
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
      setBusy(null)
    }
  }

  const chooseCli = async () => {
    const previousPath = cliStatus?.path || ''
    setBusy('path')
    try {
      const status = await window.api.arduino.chooseCli()
      await loadArduinoData(true)
      if (status.installed && (status.path || '') !== previousPath) {
        showToast('success', t('dialog.arduino.cliChosen', { version: status.version || '' }))
      } else if (!status.installed) {
        showToast('warning', t('dialog.arduino.cliChosenFail'))
      }
    } catch (err) {
      showToast('error', (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const updateIndex = async () => {
    setBusy('index')
    setPanelVisible(true)
    setPanelView('output')
    try {
      await window.api.arduino.updateIndex()
      showToast('success', t('dialog.arduino.indexDone'))
      await loadArduinoData(true)
    } catch (err) {
      showToast('error', (err as Error).message || t('dialog.arduino.indexFailed'))
    } finally {
      setBusy(null)
    }
  }

  const applyUrls = async () => {
    const lines = urls
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const invalid = lines.find((line) => !/^https?:\/\/\S+$/i.test(line))
    if (invalid) {
      setUrlsError(t('dialog.arduino.urlsInvalid', { url: invalid }))
      return
    }
    setUrlsError('')
    try {
      await updateSettings({ arduino: { additionalUrls: lines } })
      showToast('success', t('dialog.arduino.urlsApplied'))
      showConfirm({
        title: t('dialog.arduino.urlsOfferTitle'),
        message: t('dialog.arduino.urlsOfferMessage'),
        confirmLabel: t('dialog.arduino.urlsOfferConfirm'),
        onConfirm: updateIndex,
      })
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  const addLibraryDir = async () => {
    try {
      const dir = await window.api.app.pickFolder(t('dialog.arduino.pickFolder'))
      if (!dir) return
      const dirs = settings.arduino.libraryDirs
      if (dirs.includes(dir)) return
      await updateSettings({ arduino: { libraryDirs: [...dirs, dir] } })
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  const removeLibraryDir = (dir: string) => {
    apply({ arduino: { libraryDirs: settings.arduino.libraryDirs.filter((item) => item !== dir) } })
  }

  const pickSketchbook = async () => {
    try {
      const dir = await window.api.app.pickFolder(t('dialog.arduino.pickFolder'))
      if (!dir) return
      await updateSettings({ arduino: { sketchbookDir: dir } })
    } catch (err) {
      showToast('error', (err as Error).message)
    }
  }

  return (
    <div>
      <div className="section-card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="badge" style={{ gap: 5 }}>
            <Cpu size={11} />
            {t('dialog.arduino.cli')}
          </span>
          <span className={`badge ${installed ? 'success' : 'error'}`}>
            {installed ? t('dialog.arduino.cliInstalled') : t('dialog.arduino.cliNotInstalled')}
          </span>
          {installed && cliStatus?.version && <span className="mono-sm">{cliStatus.version}</span>}
          <div className="spacer" />
          <button type="button" className="btn small" disabled={busy !== null} onClick={() => void installCli()}>
            <RefreshCw size={12} className={busy === 'cli' ? 'spin' : ''} />
            {installed ? t('dialog.arduino.cliReinstall') : t('dialog.arduino.cliInstall')}
          </button>
        </div>
        {installed && cliStatus?.path && (
          <div className="mono-sm" style={{ marginTop: 8 }} title={cliStatus.path}>
            {t('dialog.arduino.cliPath')}: {cliStatus.path}
          </div>
        )}
        {!installed && <div className="field-hint" style={{ marginTop: 8 }}>{t('dialog.arduino.cliMissingHint')}</div>}
        <div className="field-row" style={{ marginTop: 10 }}>
          <button type="button" className="btn small ghost" disabled={busy !== null} onClick={() => void chooseCli()}>
            <FolderOpen size={12} />
            {t('dialog.arduino.cliChoose')}
          </button>
          <button type="button" className="btn small ghost" disabled={!installed || busy !== null} onClick={() => void updateIndex()}>
            <RefreshCw size={12} className={busy === 'index' ? 'spin' : ''} />
            {t('dialog.arduino.updateIndex')}
          </button>
        </div>
        {busy !== null && (
          <div style={{ marginTop: 10 }}>
            <ProgressLine
              label={
                busy === 'cli'
                  ? t('dialog.arduino.cliInstalling')
                  : busy === 'index'
                    ? t('dialog.arduino.cliIndexing')
                    : t('common.loading')
              }
            />
          </div>
        )}
      </div>

      <div className="section">
        <div className="field">
          <label className="field-label">{t('dialog.arduino.urls')}</label>
          <textarea
            className="textarea"
            rows={4}
            spellCheck={false}
            value={urls}
            placeholder={t('dialog.arduino.urlsPlaceholder')}
            onChange={(e) => {
              setUrls(e.target.value)
              if (urlsError) setUrlsError('')
            }}
          />
          {urlsError ? (
            <span className="field-hint error-text">{urlsError}</span>
          ) : (
            <span className="field-hint">{t('dialog.arduino.urlsHint')}</span>
          )}
          <div className="field-row">
            <button type="button" className="btn small" onClick={() => void applyUrls()}>
              <Check size={12} />
              {t('dialog.arduino.urlsApply')}
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          <FolderOpen size={13} />
          {t('dialog.arduino.libraryDirs')}
        </div>
        <div className="chip-list">
          {settings.arduino.libraryDirs.length === 0 && (
            <span className="field-hint">{t('dialog.arduino.noLibraryDirs')}</span>
          )}
          {settings.arduino.libraryDirs.map((dir) => (
            <span className="chip" key={dir}>
              <FolderOpen size={11} />
              <span className="chip-path" title={dir}>
                {dir}
              </span>
              <button type="button" title={t('common.remove')} aria-label={t('common.remove')} onClick={() => removeLibraryDir(dir)}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="field-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn small ghost" onClick={() => void addLibraryDir()}>
            <FolderOpen size={12} />
            {t('dialog.arduino.addFolder')}
          </button>
        </div>
        <span className="field-hint">{t('dialog.arduino.libraryDirsHint')}</span>
      </div>

      <div className="section">
        <div className="field">
          <span className="field-label">{t('dialog.arduino.sketchbook')}</span>
          <div className="field-row">
            <input
              className="input mono"
              readOnly
              title={settings.arduino.sketchbookDir}
              value={settings.arduino.sketchbookDir}
              placeholder={t('dialog.arduino.sketchbookNotSet')}
            />
            <button type="button" className="btn small" onClick={() => void pickSketchbook()}>
              <FolderOpen size={12} />
              {t('common.choose')}
            </button>
            {settings.arduino.sketchbookDir && (
              <button type="button" className="icon-btn sm" title={t('dialog.arduino.clear')} onClick={() => apply({ arduino: { sketchbookDir: '' } })}>
                <X size={12} />
              </button>
            )}
          </div>
          <span className="field-hint">
            {settings.arduino.sketchbookDir
              ? t('dialog.arduino.sketchbookHint')
              : cliStatus?.userDir
                ? t('dialog.arduino.sketchbookEffective', { path: cliStatus.userDir })
                : t('dialog.arduino.sketchbookHint')}
          </span>
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          <Plug size={13} />
          {t('dialog.arduino.serial')}
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label">{t('dialog.arduino.baud')}</label>
            <select className="select" value={settings.arduino.baud} onChange={(e) => void setBaud(Number(e.target.value))}>
              {BAUD_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </select>
            <span className="field-hint">{t('dialog.arduino.baudHint')}</span>
          </div>
          <div className="field">
            <label className="field-label">{t('dialog.arduino.lineEnding')}</label>
            <select
              className="select"
              value={settings.arduino.monitorLineEnding}
              onChange={(e) =>
                apply({ arduino: { monitorLineEnding: e.target.value as 'none' | 'lf' | 'crlf' } })
              }
            >
              <option value="none">{t('dialog.arduino.lineEnding.none')}</option>
              <option value="lf">{t('dialog.arduino.lineEnding.lf')}</option>
              <option value="crlf">{t('dialog.arduino.lineEnding.crlf')}</option>
            </select>
            <span className="field-hint">{t('dialog.arduino.lineEndingHint')}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <SwitchRow
          label={t('dialog.arduino.compileVerbose')}
          hint={t('dialog.arduino.compileVerboseHint')}
          checked={settings.arduino.compileVerbose}
          onChange={(compileVerbose) => apply({ arduino: { compileVerbose } })}
        />
        <SwitchRow
          label={t('dialog.arduino.autoInstallCore')}
          hint={t('dialog.arduino.autoInstallCoreHint')}
          checked={settings.arduino.autoInstallCore}
          onChange={(autoInstallCore) => apply({ arduino: { autoInstallCore } })}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ ai tab */

function AiTab() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const apply = useApplySettings()
  const showToast = useApp((s) => s.showToast)
  const ai = settings.ai
  const [showKey, setShowKey] = useState(false)

  const baseUrl = useDraft(ai.baseUrl, (next) => apply({ ai: { baseUrl: next.trim() } }), 400)
  const apiKey = useDraft(ai.apiKey, (next) => apply({ ai: { apiKey: next.trim() } }), 400)
  const model = useDraft(ai.model, (next) => apply({ ai: { model: next.trim() } }), 400)
  const systemPrompt = useDraft(ai.systemPrompt, (next) => apply({ ai: { systemPrompt: next } }), 500)

  const resetPrompt = () => {
    systemPrompt.setDraft(DEFAULT_SETTINGS.ai.systemPrompt)
    apply({ ai: { systemPrompt: DEFAULT_SETTINGS.ai.systemPrompt } })
    showToast('success', t('dialog.ai.promptReset'))
  }

  return (
    <div>
      <div className="section">
        <div className="section-title">
          <Bot size={13} />
          {t('dialog.ai.connection')}
        </div>
        <div className="field">
          <label className="field-label">{t('dialog.ai.baseUrl')}</label>
          <input
            className="input mono"
            value={baseUrl.draft}
            spellCheck={false}
            onChange={(e) => baseUrl.setDraft(e.target.value)}
            onBlur={baseUrl.flush}
          />
          <span className="field-hint">{t('dialog.ai.baseUrlHint')}</span>
        </div>
        <div className="field">
          <label className="field-label">{t('dialog.ai.apiKey')}</label>
          <div className="icon-field">
            <input
              className="input mono"
              type={showKey ? 'text' : 'password'}
              value={apiKey.draft}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => apiKey.setDraft(e.target.value)}
              onBlur={apiKey.flush}
            />
            <button
              type="button"
              className="icon-btn"
              title={showKey ? t('dialog.ai.hideKey') : t('dialog.ai.showKey')}
              aria-label={showKey ? t('dialog.ai.hideKey') : t('dialog.ai.showKey')}
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <span className="field-hint">{t('dialog.ai.apiKeyHint')}</span>
        </div>
        <div className="field">
          <label className="field-label">{t('dialog.ai.model')}</label>
          <input
            className="input mono"
            value={model.draft}
            spellCheck={false}
            onChange={(e) => model.setDraft(e.target.value)}
            onBlur={model.flush}
          />
          <span className="field-hint">{t('dialog.ai.modelHint')}</span>
        </div>
      </div>

      <div className="section">
        <div className="section-title">{t('dialog.ai.generation')}</div>
        <SliderField
          label={t('dialog.ai.temperature')}
          hint={t('dialog.ai.temperatureHint')}
          value={ai.temperature}
          min={0}
          max={2}
          step={0.1}
          format={(value) => value.toFixed(1)}
          onChange={(temperature) => apply({ ai: { temperature } })}
        />
        <NumberField
          label={t('dialog.ai.maxTokens')}
          hint={t('dialog.ai.maxTokensHint')}
          value={ai.maxTokens}
          min={128}
          max={128000}
          step={128}
          onChange={(maxTokens) => apply({ ai: { maxTokens } })}
        />
      </div>

      <div className="section">
        <div className="section-title">
          <ShieldCheck size={13} />
          {t('dialog.ai.tools')}
        </div>
        <SwitchRow
          label={t('dialog.ai.toolsEnabled')}
          checked={ai.toolsEnabled}
          onChange={(toolsEnabled) => apply({ ai: { toolsEnabled } })}
        />
        <div className="notice">
          <AlertCircle size={14} />
          <span>{t('dialog.ai.toolsHint')}</span>
        </div>
      </div>

      <div className="section">
        <div className="field">
          <div className="row">
            <label className="field-label grow">{t('dialog.ai.systemPrompt')}</label>
            <button type="button" className="btn small ghost" onClick={resetPrompt}>
              <RotateCcw size={12} />
              {t('dialog.ai.resetPrompt')}
            </button>
          </div>
          <textarea
            className="textarea"
            rows={10}
            value={systemPrompt.draft}
            spellCheck={false}
            onChange={(e) => systemPrompt.setDraft(e.target.value)}
            onBlur={systemPrompt.flush}
          />
          <span className="field-hint">{t('dialog.ai.systemPromptHint')}</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- theme tab */

function ThemeTab() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const setDialog = useApp((s) => s.setDialog)
  const apply = useApplySettings()
  const mode = settings.theme.mode

  return (
    <div>
      <div className="section">
        <div className="section-title">
          <Palette size={13} />
          {t('dialog.theme.presets')}
        </div>
        <div className="segmented">
          <button type="button" className={mode === 'dark' ? 'active' : ''} onClick={() => apply(themePreset('dark'))}>
            <Moon size={12} />
            {t('dialog.theme.preset.dark')}
          </button>
          <button type="button" className={mode === 'light' ? 'active' : ''} onClick={() => apply(themePreset('light'))}>
            <Sun size={12} />
            {t('dialog.theme.preset.light')}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">{t('dialog.theme.accent')}</div>
        <AccentPicker value={settings.theme.accent} onChange={(accent) => apply({ theme: { accent } })} />
        <span className="field-hint">{t('dialog.theme.accentHint')}</span>
      </div>

      <div className="section">
        <SliderField
          label={t('dialog.theme.scale')}
          hint={t('dialog.theme.scaleHint')}
          value={settings.theme.uiScale}
          min={0.7}
          max={1.5}
          step={0.05}
          format={(value) => `${Math.round(value * 100)}%`}
          onChange={(uiScale) => apply({ theme: { uiScale } })}
        />
      </div>

      <div className="section-card row" style={{ gap: 12 }}>
        <div className="grow">
          <div className="field-label">{t('dialog.theme.openEditor')}</div>
          <div className="field-hint">{t('dialog.theme.openEditorHint')}</div>
        </div>
        <button type="button" className="btn" onClick={() => setDialog('theme', true)}>
          <Paintbrush size={13} />
          {t('common.open')}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ dialog */

export function SettingsDialog() {
  const t = useT()
  const open = useApp((s) => s.dialogs.settings)
  const setDialog = useApp((s) => s.setDialog)
  const showConfirm = useApp((s) => s.showConfirm)
  const resetSettings = useApp((s) => s.resetSettings)
  const [tab, setTab] = useState<SettingsTab>('general')
  const overlayRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setDialog('settings', false), [setDialog])

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
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const confirmReset = () => {
    showConfirm({
      title: t('dialog.settings.resetTitle'),
      message: t('dialog.settings.resetMessage'),
      confirmLabel: t('dialog.settings.reset'),
      danger: true,
      onConfirm: async () => {
        await resetSettings()
      },
    })
  }

  return (
    <div
      className="dialog-overlay"
      ref={overlayRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="dialog wide settings-dialog" role="dialog" aria-modal="true" aria-label={t('dialog.settings')}>
        <div className="dialog-header">
          <SettingsIcon size={16} style={{ color: 'var(--text-muted)' }} />
          <span className="dialog-title">{t('dialog.settings')}</span>
          <button type="button" className="icon-btn dialog-close" title={t('common.close')} onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body with-nav">
          <nav className="dialog-nav" aria-label={t('dialog.settings')}>
            {(['general', 'editor', 'arduino', 'ai', 'theme'] as SettingsTab[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`dialog-nav-item ${tab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
              >
                {TAB_ICONS[id]}
                {t(`dialog.settings.tab.${id}`)}
              </button>
            ))}
          </nav>
          <div className="dialog-pane">
            {tab === 'general' && <GeneralTab />}
            {tab === 'editor' && <EditorTab />}
            {tab === 'arduino' && <ArduinoTab />}
            {tab === 'ai' && <AiTab />}
            {tab === 'theme' && <ThemeTab />}
          </div>
        </div>

        <div className="dialog-footer">
          <button type="button" className="btn ghost danger" onClick={confirmReset}>
            <RotateCcw size={13} />
            {t('dialog.settings.reset')}
          </button>
          <div className="spacer" />
          <button type="button" className="btn" onClick={close}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
