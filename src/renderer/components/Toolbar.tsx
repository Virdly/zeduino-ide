import {
  ArrowUpFromLine,
  CircleStop,
  Cpu,
  Download,
  FolderOpen,
  Library,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  SquareCheckBig,
  Usb,
} from 'lucide-react'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'
import { BoardPicker } from './BoardPicker'

export function Toolbar() {
  const t = useT()
  const project = useApp((s) => s.project)
  const settings = useApp((s) => s.settings)
  const ports = useApp((s) => s.ports)
  const running = useApp((s) => s.running)
  const monitor = useApp((s) => s.monitor)
  const cliStatus = useApp((s) => s.cliStatus)
  const setDialog = useApp((s) => s.setDialog)
  const setPort = useApp((s) => s.setPort)
  const refreshPorts = useApp((s) => s.refreshPorts)
  const compile = useApp((s) => s.compile)
  const upload = useApp((s) => s.upload)
  const toggleMonitor = useApp((s) => s.toggleMonitor)
  const saveActive = useApp((s) => s.saveActive)
  const ensureCli = useApp((s) => s.ensureCli)
  const setAiVisible = useApp((s) => s.setAiVisible)
  const aiVisible = useApp((s) => s.aiVisible)
  const setStatusText = useApp((s) => s.setStatusText)

  const portValue = settings.arduino.port
  const portKnown = ports.some((p) => p.port === portValue)

  const openFolder = () => void useApp.getState().projectOpenDialog()

  return (
    <header className="topbar">
      <div className="brand" title="ZedArduino IDE">
        <span className="brand-mark">
          <Cpu size={12} strokeWidth={2.6} />
        </span>
        <span>ZedArduino</span>
      </div>

      <div className="project-chip" title={project?.root || t('toolbar.noProject')}>
        <FolderOpen size={13} />
        <strong>{project?.name || t('toolbar.noProject')}</strong>
        {project?.isSketch && <span className="badge accent">{t('explorer.sketchBadge')}</span>}
      </div>

      <button className="icon-btn" title={t('toolbar.openFolder')} onClick={openFolder}>
        <FolderOpen size={15} />
      </button>
      <button
        className="icon-btn"
        title={t('toolbar.newSketch')}
        onClick={() => setDialog('newSketch', true)}
      >
        <Plus size={16} />
      </button>
      <button className="icon-btn" title={t('toolbar.save')} onClick={() => void saveActive()} disabled={!project}>
        <Save size={15} />
      </button>

      <div className="divider v" />

      <div className="board-picker">
        <BoardPicker />
        <button className="icon-btn" title={t('toolbar.boards')} onClick={() => setDialog('boards', true)}>
          <Download size={14} />
        </button>
      </div>

      <div className="board-picker">
        <Usb size={14} style={{ color: 'var(--text-muted)', flex: 'none' }} />
        <select
          className="select port"
          title={t('toolbar.portTip')}
          value={portValue}
          onChange={(e) => setPort(e.target.value)}
        >
          {!portValue && <option value="">{t('toolbar.selectPort')}</option>}
          {!portKnown && portValue && <option value={portValue}>{portValue}</option>}
          {ports.map((p) => (
            <option key={p.port} value={p.port}>
              {p.port}
              {p.boardName ? ` · ${p.boardName}` : ''}
            </option>
          ))}
          {ports.length === 0 && !portValue && <option value="">{t('toolbar.noPorts')}</option>}
        </select>
        <button
          className="icon-btn"
          title={t('common.refresh')}
          onClick={() => {
            setStatusText(t('common.loading'))
            void refreshPorts().finally(() => setStatusText(''))
          }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="tools">
        {!cliStatus?.installed && (
          <button className="btn small primary" onClick={() => void ensureCli()} title={t('welcome.setupCli')}>
            <Download size={13} /> arduino-cli
          </button>
        )}
        <div className="run-group">
          {running ? (
            <button className="btn danger" onClick={() => void useApp.getState().cancelRun()} title={t('panel.cancelRun')}>
              <CircleStop size={14} /> {t('toolbar.stop')}
            </button>
          ) : (
            <button
              className="btn"
              disabled={!project || !settings.arduino.fqbn || !cliStatus?.installed}
              onClick={() => void compile()}
              title={t('toolbar.compileHint')}
            >
              <SquareCheckBig size={14} /> {t('toolbar.compile')}
            </button>
          )}
          <button
            className="btn primary"
            disabled={!!running || !project || !settings.arduino.fqbn || !cliStatus?.installed}
            onClick={() => void upload()}
            title={t('toolbar.uploadHint')}
          >
            <ArrowUpFromLine size={14} /> {t('toolbar.upload')}
          </button>
          <button
            className={`btn ${monitor.running ? 'danger' : ''}`}
            disabled={!monitor.running && !portValue}
            onClick={() => void toggleMonitor()}
            title={t('action.monitor')}
          >
            {monitor.running ? <CircleStop size={14} /> : <Usb size={14} />}
            {monitor.running ? t('toolbar.monitorStop') : t('toolbar.monitor')}
          </button>
        </div>

        <div className="divider v" />

        <button className="icon-btn" title={t('toolbar.libraries')} onClick={() => setDialog('libraries', true)}>
          <Library size={15} />
        </button>
        <button
          className={`icon-btn ${aiVisible ? 'active' : ''}`}
          title={t('toolbar.ai')}
          onClick={() => setAiVisible(!aiVisible)}
        >
          <Sparkles size={16} />
        </button>
        <button className="icon-btn" title={t('toolbar.settings')} onClick={() => setDialog('settings', true)}>
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
