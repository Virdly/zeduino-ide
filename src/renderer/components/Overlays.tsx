import { AlertTriangle, Check, FolderOpen, Info, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
}

export function PromptDialog() {
  const t = useT()
  const prompt = useApp((s) => s.prompt)
  const closePrompt = useApp((s) => s.closePrompt)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setValue(prompt?.value || '')
    setError(null)
  }, [prompt])

  useEscape(() => closePrompt())

  if (!prompt) return null

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError(t('common.enterName'))
      return
    }
    const validation = prompt.validate?.(trimmed)
    if (validation) {
      setError(validation)
      return
    }
    setBusy(true)
    try {
      await prompt.onSubmit(trimmed)
      closePrompt()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && closePrompt()}>
      <div className="dialog dialog-narrow">
        <div className="dialog-header">
          <span className="dialog-title">{prompt.title}</span>
          <button className="icon-btn dialog-close" onClick={closePrompt}>
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body">
          {prompt.label && <div className="field-hint" style={{ marginBottom: 8 }}>{prompt.label}</div>}
          <div className="field">
            <input
              autoFocus
              className="input"
              value={value}
              placeholder={prompt.placeholder}
              onChange={(e) => {
                setValue(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
            />
            {error ? <span className="field-hint error-text">{error}</span> : prompt.hint ? <span className="field-hint">{prompt.hint}</span> : null}
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn ghost" onClick={closePrompt}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy}>
            {busy && <span className="spinner" />}
            {prompt.confirmLabel || t('common.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmDialog() {
  const t = useT()
  const confirm = useApp((s) => s.confirm)
  const closeConfirm = useApp((s) => s.closeConfirm)
  const [busy, setBusy] = useState(false)

  useEscape(() => closeConfirm())

  if (!confirm) return null

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeConfirm()}>
      <div className="dialog dialog-narrow">
        <div className="dialog-header">
          <span className="dialog-title">{confirm.title}</span>
          <button className="icon-btn dialog-close" onClick={closeConfirm}>
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="modal-message">{confirm.message}</div>
        </div>
        <div className="dialog-footer">
          <button className="btn ghost" onClick={closeConfirm}>{t('common.cancel')}</button>
          <button
            className={`btn ${confirm.danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await confirm.onConfirm()
                closeConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <span className="spinner" />}
            {confirm.confirmLabel || t('common.yes')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function NewSketchDialog() {
  const t = useT()
  const open = useApp((s) => s.dialogs.newSketch)
  const setDialog = useApp((s) => s.setDialog)
  const parentDefault = useApp((s) => s.newSketchParent)
  const project = useApp((s) => s.project)
  const refreshRecent = useApp((s) => s.refreshRecent)
  const showToast = useApp((s) => s.showToast)
  const openFile = useApp((s) => s.openFile)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setParent('')
    setError(null)
  }, [open])

  const close = () => setDialog('newSketch', false)
  useEscape(close)

  if (!open) return null

  const valid = /^[A-Za-z0-9_-]+$/.test(name.trim())
  const parentValue = parent

  const create = async () => {
    if (!valid) {
      setError(t('sketch.invalidName'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const info = await window.api.project.createSketch(name.trim(), parent || undefined)
      await refreshRecent()
      close()
      showToast('success', t('toast.sketchCreated', { name }))
      await openFile(`${info.name}.ino`)
    } catch (err) {
      setError(t('sketch.createFailed', { error: (err as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog dialog-narrow">
        <div className="dialog-header">
          <span className="dialog-title">{t('sketch.newTitle')}</span>
          <button className="icon-btn dialog-close" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label className="field-label">{t('sketch.nameLabel')}</label>
            <input
              autoFocus
              className="input"
              value={name}
              placeholder="Blink"
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create()
              }}
            />
            <span className="field-hint">{t('sketch.nameHint')}</span>
          </div>
          <div className="field">
            <label className="field-label">{t('sketch.parentLabel')}</label>
            <div className="field-row">
              <input className="input" value={parentValue} readOnly placeholder={t('sketch.parentHint')} title={parent} />
              <button
                className="btn"
                onClick={async () => {
                  const folder = await window.api.app.pickFolder(t('sketch.parentLabel'))
                  if (folder) setParent(folder)
                }}
              >
                <FolderOpen size={14} />
              </button>
            </div>
            <span className="field-hint">
              {parent === '%parent%' && project ? project.root : t('sketch.parentHint')}
            </span>
          </div>
          {error && <div className="error-text" style={{ fontSize: 12 }}>{error}</div>}
        </div>
        <div className="dialog-footer">
          <button className="btn ghost" onClick={close}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={busy} onClick={() => void create()}>
            {busy && <span className="spinner" />} {t('sketch.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toasts() {
  const toast = useApp((s) => s.toast)
  const clearToast = useApp((s) => s.clearToast)
  if (!toast) return null
  const Icon = toast.kind === 'error' ? XCircle : toast.kind === 'warning' ? AlertTriangle : toast.kind === 'success' ? Check : Info
  return (
    <div className="toast-stack">
      <div className={`toast ${toast.kind}`} onClick={clearToast}>
        <Icon size={15} className={toast.kind === 'error' ? 'error-text' : toast.kind === 'success' ? 'success-text' : toast.kind === 'warning' ? 'warning-text' : ''} />
        <span style={{ flex: 1 }}>{toast.message}</span>
        <X size={13} style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
      </div>
    </div>
  )
}
