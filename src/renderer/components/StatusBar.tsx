import { AlertTriangle, CircuitBoard, Moon, Plug, Sun, Wifi } from 'lucide-react'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'

export interface CursorInfo {
  line: number
  col: number
  sel: number
}

export function StatusBar({ cursor }: { cursor: CursorInfo }) {
  const t = useT()
  const project = useApp((s) => s.project)
  const settings = useApp((s) => s.settings)
  const cliStatus = useApp((s) => s.cliStatus)
  const monitor = useApp((s) => s.monitor)
  const problems = useApp((s) => s.problems)
  const running = useApp((s) => s.running)
  const progress = useApp((s) => s.progress)
  const statusText = useApp((s) => s.statusText)
  const setDialog = useApp((s) => s.setDialog)
  const updateSettings = useApp((s) => s.updateSettings)
  const setLanguage = useApp((s) => s.setLanguage)

  const boardName = settings.arduino.fqbn ? settings.arduino.fqbn : ''
  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.filter((p) => p.severity === 'warning').length
  const isDark = settings.theme.mode !== 'light'

  return (
    <footer className="statusbar">
      <button
        className={`item ${cliStatus?.installed ? '' : 'error'}`}
        title={cliStatus?.installed ? cliStatus.path : t('status.cliMissing')}
        onClick={() => setDialog('boards', true)}
        style={{ cursor: 'pointer' }}
      >
        <Wifi size={12} />
        {cliStatus?.installed ? t('status.cliVersion', { version: cliStatus.version || '?' }) : t('status.cliMissing')}
      </button>
      <button className="item" title={t('toolbar.boardTip')} onClick={() => setDialog('boards', true)} style={{ cursor: 'pointer' }}>
        <CircuitBoard size={12} />
        {boardName ? <span className="ellipsis" style={{ maxWidth: 180 }}>{boardName}</span> : t('status.noBoard')}
      </button>
      {settings.arduino.port && (
        <span className="item">
          <Plug size={12} />
          {settings.arduino.port}
        </span>
      )}
      {monitor.running && <span className="item ok">{t('status.monitor', { port: settings.arduino.port })}</span>}
      {problems.length > 0 && (
        <button
          className="item"
          onClick={() => useApp.getState().setPanelView('problems')}
          title={`${t('panel.problems')}: ${errors}/${warnings}`}
          style={{ cursor: 'pointer' }}
        >
          <AlertTriangle size={12} className={errors ? 'error' : 'warning-text'} />
          {t('status.problems', { count: problems.length })}
        </button>
      )}
      {statusText && <span className="item">{statusText}</span>}
      {running && (
        <span className="item">
          <span className="spinner" style={{ width: 11, height: 11 }} />
          {progress?.percent !== undefined ? `${progress.percent}%` : running.title}
        </span>
      )}
      <div className="grow" />
      {project?.isSketch && <span className="item optional muted">{t('explorer.sketchBadge')}: {project.sketchName}</span>}
      <span className="item" title="Cursor">
        {t('status.line', { line: cursor.line, col: cursor.col })}
        {cursor.sel > 0 ? ` (${cursor.sel})` : ''}
      </span>
      <span className="item optional">{t('status.spaces', { n: settings.editor.tabSize })}</span>
      <span className="item">{settings.editor.autoSave ? `${t('status.utf8')} · auto` : t('status.utf8')}</span>
      <button
        className="item"
        title={t('common.language')}
        onClick={() => void setLanguage(settings.language === 'ru' ? 'en' : 'ru')}
        style={{ cursor: 'pointer' }}
      >
        {settings.language === 'ru' ? 'RU' : 'EN'}
      </button>
      <button
        className="item"
        title={isDark ? t('action.themeLight') : t('action.themeDark')}
        onClick={() =>
          void updateSettings({
            theme: { mode: isDark ? 'light' : 'dark', accent: isDark ? '#2563eb' : '#4c9aff' },
          })
        }
        style={{ cursor: 'pointer' }}
      >
        {isDark ? <Moon size={12} /> : <Sun size={12} />}
      </button>
    </footer>
  )
}
