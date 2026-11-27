import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Moon, Palette, RotateCcw, Sun, X } from 'lucide-react'
import { DARK_COLORS, LIGHT_COLORS, isLight, withAlpha } from '../../shared/theme'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import type { ThemeColors } from '../../shared/types'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'
import './dialogs.css'

/* ---------------------------------------------------------------- helpers */

const COLOR_KEYS: (keyof ThemeColors)[] = [
  'bg',
  'bgElevated',
  'bgPanel',
  'bgHover',
  'bgActive',
  'border',
  'text',
  'textMuted',
  'accent',
  'accentText',
  'selection',
  'error',
  'warning',
  'success',
  'info',
  'editorBg',
  'editorText',
  'editorGutter',
  'editorCursor',
  'editorSelection',
]

function isHex6(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value)
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

/* ------------------------------------------------------------- color row */

function ColorRow({
  colorKey,
  value,
  overridden,
  onCommit,
}: {
  colorKey: keyof ThemeColors
  value: string
  overridden: boolean
  onCommit: (key: keyof ThemeColors, value: string) => void
}) {
  const t = useT()
  const [draft, setDraft] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const syncedRef = useRef(value)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  const safe = isHex6(value) ? value : '#000000'
  const label = t(`dialog.themeEditor.color.${colorKey}`)

  useEffect(() => {
    if (value !== syncedRef.current) {
      syncedRef.current = value
      setDraft(value)
      setInvalid(false)
    }
  }, [value])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      const pending = draftRef.current.trim().toLowerCase()
      if (pending !== syncedRef.current && isHex6(pending)) {
        syncedRef.current = pending
        commitRef.current(colorKey, pending)
      }
    },
    [colorKey],
  )

  const commit = (next: string) => {
    const color = next.trim().toLowerCase()
    if (!isHex6(color)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    syncedRef.current = color
    setDraft(color)
    onCommit(colorKey, color)
  }

  const changeText = (next: string) => {
    setDraft(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => commit(next), 120)
  }

  const changeSwatch = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const color = next.toLowerCase()
    syncedRef.current = color
    setDraft(color)
    setInvalid(false)
    onCommit(colorKey, color)
  }

  return (
    <div className="color-row">
      <label className="color-label" title={label}>
        {overridden && <span className="color-dot" title={t('dialog.themeEditor.modified')} />}
        <span>{label}</span>
      </label>
      <input
        className="swatch-input"
        type="color"
        value={safe}
        aria-label={label}
        title={label}
        onChange={(e) => changeSwatch(e.target.value)}
      />
      <input
        className={`input color-hex ${invalid ? 'invalid' : ''}`}
        value={draft}
        spellCheck={false}
        maxLength={7}
        aria-label={`${label} — ${t('dialog.themeEditor.invalidHex')}`}
        title={t('dialog.themeEditor.invalidHex')}
        onChange={(e) => changeText(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
          }
        }}
      />
    </div>
  )
}

/* ---------------------------------------------------------- scale slider */

function ScaleSlider() {
  const t = useT()
  const uiScale = useApp((s) => s.settings.theme.uiScale)
  const updateSettings = useApp((s) => s.updateSettings)
  const showToast = useApp((s) => s.showToast)
  const [draft, setDraft] = useState(uiScale)
  const pendingRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (pendingRef.current === null) setDraft(uiScale)
  }, [uiScale])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const commit = useCallback(
    (value: number) => {
      void updateSettings({ theme: { uiScale: value } }).catch((err: unknown) => {
        showToast('error', (err as Error).message)
      })
    },
    [updateSettings, showToast],
  )

  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (pendingRef.current === null) return
    const value = pendingRef.current
    pendingRef.current = null
    commit(value)
  }

  const change = (value: number) => {
    setDraft(value)
    pendingRef.current = value
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 180)
  }

  return (
    <div className="field">
      <label className="field-label">{t('dialog.themeEditor.scale')}</label>
      <div className="slider-row">
        <input
          className="range"
          type="range"
          min={0.7}
          max={1.5}
          step={0.05}
          value={draft}
          onChange={(e) => change(Number(e.target.value))}
          onPointerUp={flush}
          onKeyUp={flush}
          onBlur={flush}
        />
        <span className="slider-value">{Math.round(draft * 100)}%</span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- preview */

function ThemePreview({ accent }: { accent: string }) {
  const t = useT()
  return (
    <div className="theme-preview">
      <div className="theme-preview-bar">
        <span className="theme-preview-dot" />
        <span className="theme-preview-dot" />
        <span className="theme-preview-dot" />
        <span className="theme-preview-title">{t('dialog.themeEditor.preview')}</span>
        <div className="spacer" />
        <span className="badge accent">{t('dialog.themeEditor.previewButton')}</span>
      </div>
      <div className="theme-preview-body">
        <div className="theme-preview-gutter">{'1\n2\n3\n4'}</div>
        <pre className="theme-preview-code">
          <span className="kw">void</span> <span className="fn">setup</span>() {'{'}
          {'\n  '}
          <span className="fn">Serial</span>.begin(<span className="num">9600</span>);
          {'\n  '}
          <span
            className="str"
            style={{ background: withAlpha(accent, 0.16), borderRadius: 3, padding: '0 2px' }}
          >
            "ZedArduino"
          </span>
          {'\n  '}
          <span className="cm">// comment</span>
          {'\n}'}
        </pre>
      </div>
      <div className="theme-preview-footer">
        <span>{t('dialog.themeEditor.previewStatus')}</span>
        <div className="spacer" />
        <span className="accent">●</span>
        <span>{t('dialog.themeEditor.previewText')}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ dialog */

export function ThemeEditorDialog() {
  const t = useT()
  const open = useApp((s) => s.dialogs.theme)
  const setDialog = useApp((s) => s.setDialog)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const showConfirm = useApp((s) => s.showConfirm)
  const showToast = useApp((s) => s.showToast)
  const overlayRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setDialog('theme', false), [setDialog])

  useTopmostEscape(open, overlayRef, close)

  const theme = settings.theme

  const apply = useCallback(
    (patch: Record<string, unknown>) => {
      void updateSettings(patch).catch((err: unknown) => {
        showToast('error', (err as Error).message)
      })
    },
    [updateSettings, showToast],
  )

  const base = useMemo(() => {
    if (theme.mode === 'custom') {
      return theme.colors.bg && isLight(theme.colors.bg) ? LIGHT_COLORS : DARK_COLORS
    }
    return theme.mode === 'light' ? LIGHT_COLORS : DARK_COLORS
  }, [theme.mode, theme.colors.bg])

  const effective = useMemo(() => ({ ...base, ...theme.colors }) as ThemeColors, [base, theme.colors])

  // Keep the latest color map across rapid edits: settings arrive asynchronously.
  const colorsRef = useRef<Partial<ThemeColors>>(theme.colors)
  useEffect(() => {
    colorsRef.current = theme.colors
  }, [theme.colors])

  const setColor = (key: keyof ThemeColors, value: string) => {
    if (!isHex6(value)) return
    const color = value.toLowerCase()
    const colors = { ...colorsRef.current, [key]: color }
    colorsRef.current = colors
    const themePatch: Record<string, unknown> = { mode: 'custom', colors }
    // applyTheme always prefers theme.accent over colors.accent, keep both in sync.
    if (key === 'accent') themePatch.accent = color
    apply({ theme: themePatch })
  }

  const applyPreset = (mode: 'dark' | 'light') => {
    const colors = mode === 'light' ? { ...LIGHT_COLORS } : { ...DARK_COLORS }
    colorsRef.current = colors
    apply({ theme: { mode, colors } })
  }

  const resetCustom = () => {
    const colors = { ...base }
    colorsRef.current = colors
    apply({ theme: { mode: 'custom', colors } })
    showToast('success', t('dialog.themeEditor.customReset'))
  }

  const confirmReset = () => {
    showConfirm({
      title: t('dialog.themeEditor.resetTitle'),
      message: t('dialog.themeEditor.resetMessage'),
      confirmLabel: t('dialog.themeEditor.resetColors'),
      danger: true,
      onConfirm: async () => {
        try {
          colorsRef.current = { ...DARK_COLORS }
          await updateSettings({
            theme: {
              mode: 'dark',
              colors: { ...DARK_COLORS },
              accent: DEFAULT_SETTINGS.theme.accent,
              uiScale: 1,
            },
          })
          showToast('success', t('dialog.themeEditor.resetDone'))
        } catch (err) {
          showToast('error', (err as Error).message)
        }
      },
    })
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
      <div className="dialog wide theme-dialog" role="dialog" aria-modal="true" aria-label={t('dialog.themeEditor')}>
        <div className="dialog-header">
          <Palette size={16} style={{ color: 'var(--text-muted)' }} />
          <span className="dialog-title">{t('dialog.themeEditor')}</span>
          <span className="badge accent">
            {theme.mode === 'dark'
              ? t('dialog.mode.dark')
              : theme.mode === 'light'
                ? t('dialog.mode.light')
                : t('dialog.mode.custom')}
          </span>
          <button type="button" className="icon-btn dialog-close" title={t('common.close')} onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="dialog-body theme-editor-body">
          <div className="theme-editor-main">
            <div className="section-title">
              <Palette size={13} />
              {t('dialog.themeEditor.colors')}
            </div>
            <div className="field-hint" style={{ marginBottom: 10 }}>
              {t('dialog.themeEditor.colorsHint')}
            </div>
            <div className="color-grid">
              {COLOR_KEYS.map((key) => (
                <ColorRow
                  key={key}
                  colorKey={key}
                  value={effective[key]}
                  overridden={effective[key].toLowerCase() !== base[key].toLowerCase()}
                  onCommit={setColor}
                />
              ))}
            </div>
          </div>

          <aside className="theme-editor-side">
            <div className="section">
              <div className="section-title">{t('dialog.themeEditor.presets')}</div>
              <div className="segmented" style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                <button
                  type="button"
                  className={theme.mode === 'dark' ? 'active' : ''}
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => applyPreset('dark')}
                >
                  <Moon size={12} />
                  {t('dialog.themeEditor.preset.dark')}
                </button>
                <button
                  type="button"
                  className={theme.mode === 'light' ? 'active' : ''}
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => applyPreset('light')}
                >
                  <Sun size={12} />
                  {t('dialog.themeEditor.preset.light')}
                </button>
                <button type="button" style={{ justifyContent: 'flex-start' }} onClick={resetCustom}>
                  <RotateCcw size={12} />
                  {t('dialog.themeEditor.preset.resetCustom')}
                </button>
              </div>
            </div>

            <ScaleSlider />

            <div className="section">
              <div className="section-title">{t('dialog.themeEditor.preview')}</div>
              <ThemePreview accent={effective.accent} />
            </div>
          </aside>
        </div>

        <div className="dialog-footer">
          <button type="button" className="btn ghost danger" onClick={confirmReset}>
            <RotateCcw size={13} />
            {t('dialog.themeEditor.resetColors')}
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
