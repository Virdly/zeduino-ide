import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  CircleStop,
  Copy,
  Plug,
  RefreshCw,
  Send,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react'
import { useApp, type ProblemItem } from '../state/store'
import { useT } from '../i18n/useT'

function relativePath(absPath: string, root: string | undefined): string | null {
  if (!root) return null
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalized = absPath.replace(/\\/g, '/')
  if (normalized.toLowerCase().startsWith(normalizedRoot.toLowerCase() + '/')) {
    return normalized.slice(normalizedRoot.length + 1)
  }
  return null
}

function lineClass(text: string): string {
  if (/\berror:|\bfatal error:|\bError\b/.test(text)) return 'error-line'
  if (/\bwarning:/.test(text)) return 'warning-line'
  if (/^(Sketch uses|Global variables|Bytes used)/.test(text)) return 'success-line'
  if (/\bCompiling\b|\bUsing board\b|\bUsing core\b/.test(text)) return 'info-line'
  return ''
}

function OutputView() {
  const t = useT()
  const output = useApp((s) => s.output)
  const project = useApp((s) => s.project)
  const openFile = useApp((s) => s.openFile)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    if (!follow) return
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output, follow])

  if (!output.length) {
    return <div className="empty-state">{t('panel.outputEmpty')}</div>
  }

  const jump = async (text: string) => {
    const m = text.match(/^(.+?\.(?:ino|h|hpp|c|cpp|cxx|cc)):(\d+):(\d+)?/)
    if (!m) return
    const rel = relativePath(m[1], project?.root)
    if (!rel) return
    await openFile(rel)
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('zeduino:editor', { detail: { action: 'goto', line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined } }),
      )
    }, 60)
  }

  return (
    <div
      className="output-view"
      ref={scrollerRef}
      onScroll={(e) => {
        const el = e.currentTarget
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
      }}
    >
      {output.map((line) => {
        const cls = lineClass(line.text)
        const clickable = /^(.+?\.(?:ino|h|hpp|c|cpp|cxx|cc)):\d+/.test(line.text)
        return (
          <div
            key={line.id}
            className={`out-line ${cls} ${line.stream === 'system' ? 'system' : ''} ${clickable ? 'link' : ''}`}
            onClick={() => clickable && void jump(line.text)}
          >
            {line.text || ' '}
          </div>
        )
      })}
      {follow ? null : (
        <button
          className="btn small"
          style={{ position: 'sticky', bottom: 6, left: '50%' }}
          onClick={() => {
            setFollow(true)
            const el = scrollerRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
        >
          <ArrowDownToLine size={12} /> {t('serial.autoScroll')}
        </button>
      )}
    </div>
  )
}

function SerialView() {
  const t = useT()
  const monitor = useApp((s) => s.monitor)
  const settings = useApp((s) => s.settings)
  const ports = useApp((s) => s.ports)
  const setBaud = useApp((s) => s.setBaud)
  const setPort = useApp((s) => s.setPort)
  const startMonitor = useApp((s) => s.startMonitor)
  const stopMonitor = useApp((s) => s.stopMonitor)
  const sendSerial = useApp((s) => s.sendSerial)
  const clearSerial = useApp((s) => s.clearSerial)
  const refreshPorts = useApp((s) => s.refreshPorts)
  const updateSettings = useApp((s) => s.updateSettings)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!monitor.autoScroll) return
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [monitor.buffer, monitor.autoScroll])

  const portsList = useMemo(() => {
    const list = ports.map((p) => p.port)
    if (settings.arduino.port && !list.includes(settings.arduino.port)) list.push(settings.arduino.port)
    return list
  }, [ports, settings.arduino.port])

  const send = () => {
    if (!draft.trim() && settings.arduino.monitorLineEnding === 'none') return
    void sendSerial(draft)
    setDraft('')
    inputRef.current?.focus()
  }

  return (
    <>
      <div className="serial-toolbar">
        <select className="select" value={settings.arduino.port} onChange={(e) => setPort(e.target.value)}>
          {!settings.arduino.port && <option value="">{t('serial.noPort')}</option>}
          {portsList.map((port) => (
            <option key={port} value={port}>
              {port}
            </option>
          ))}
        </select>
        <select className="select" value={settings.arduino.baud} onChange={(e) => void setBaud(Number(e.target.value))}>
          {[9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000].map((baud) => (
            <option key={baud} value={baud}>
              {baud}
            </option>
          ))}
        </select>
        {monitor.running ? (
          <button className="btn danger small" onClick={() => void stopMonitor()}>
            <CircleStop size={12} /> {t('serial.disconnect')}
          </button>
        ) : (
          <button className="btn primary small" onClick={() => void startMonitor()} disabled={!settings.arduino.port}>
            <Plug size={12} /> {t('serial.connect')}
          </button>
        )}
        <button className="icon-btn" title={t('common.refresh')} onClick={() => void refreshPorts()}>
          <RefreshCw size={13} />
        </button>
        <span className={`badge ${monitor.running ? 'success' : ''}`}>
          {monitor.running ? t('serial.connected', { port: settings.arduino.port }) : t('serial.disconnected')}
        </span>
        <div className="spacer" />
        <label className="row" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={monitor.autoScroll}
            onChange={(e) => useApp.setState({ monitor: { ...monitor, autoScroll: e.target.checked } })}
          />
          {t('serial.autoScroll')}
        </label>
        <button className="icon-btn" title={t('serial.clear')} onClick={() => clearSerial()}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="serial-log" ref={logRef}>
        {monitor.buffer ? monitor.buffer : <span className="sys">{`${t('serial.empty')}\n`}</span>}
      </div>
      <div className="serial-input-row">
        <input
          ref={inputRef}
          className="input"
          value={draft}
          placeholder={monitor.running ? t('serial.placeholder') : t('serial.empty')}
          disabled={!monitor.running}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
        />
        <select
          className="select"
          style={{ width: 108, height: 28 }}
          value={settings.arduino.monitorLineEnding}
          onChange={(e) => void updateSettings({ arduino: { monitorLineEnding: e.target.value } })}
          title={t('serial.lineEnding')}
        >
          <option value="none">без \n</option>
          <option value="lf">\n LF</option>
          <option value="crlf">\r\n CRLF</option>
        </select>
        <button className="btn primary" onClick={send} disabled={!monitor.running}>
          <Send size={13} /> {t('serial.send')}
        </button>
      </div>
    </>
  )
}

function ProblemsView() {
  const t = useT()
  const problems = useApp((s) => s.problems)
  const project = useApp((s) => s.project)
  const openFile = useApp((s) => s.openFile)

  if (!problems.length) return <div className="empty-state">{t('panel.problemsEmpty')}</div>

  const jump = async (problem: ProblemItem) => {
    const rel = relativePath(problem.file, project?.root)
    if (!rel) return
    await openFile(rel)
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('zeduino:editor', { detail: { action: 'goto', line: problem.line, column: problem.column } }),
      )
    }, 60)
  }

  return (
    <div className="problems-view">
      {problems.map((problem) => (
        <div
          key={problem.id}
          className={`problem-row ${problem.severity}`}
          onClick={() => void jump(problem)}
          title={problem.file}
        >
          {problem.severity === 'error' ? (
            <AlertTriangle size={13} className="p-sev error-text" />
          ) : (
            <AlertTriangle size={13} className="p-sev warning-text" />
          )}
          <span className="p-file">
            {problem.file.split(/[\\/]/).pop()}:{problem.line}
          </span>
          <span className="p-msg">{problem.message}</span>
        </div>
      ))}
    </div>
  )
}

export function BottomPanel() {
  const t = useT()
  const view = useApp((s) => s.panelView)
  const setView = useApp((s) => s.setPanelView)
  const panelHeight = useApp((s) => s.panelHeight)
  const setPanelVisible = useApp((s) => s.setPanelVisible)
  const running = useApp((s) => s.running)
  const progress = useApp((s) => s.progress)
  const monitor = useApp((s) => s.monitor)
  const problems = useApp((s) => s.problems)
  const output = useApp((s) => s.output)
  const clearOutput = useApp((s) => s.clearOutput)
  const lastCompile = useApp((s) => s.lastCompile)
  const showToast = useApp((s) => s.showToast)
  const cancelRun = useApp((s) => s.cancelRun)

  const errorCount = problems.filter((p) => p.severity === 'error').length

  const copyAll = async () => {
    const text =
      view === 'serial' ? monitor.buffer : view === 'problems' ? problems.map((p) => `${p.file}:${p.line}: ${p.severity}: ${p.message}`).join('\n') : output.map((l) => l.text).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      showToast('success', t('toast.copied'))
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="bottom-panel" style={{ height: panelHeight }}>
      <div className="panel-tabs">
        <button className={`panel-tab ${view === 'output' ? 'active' : ''}`} onClick={() => setView('output')}>
          <TerminalIcon size={13} />
          {t('panel.output')}
          {lastCompile && !lastCompile.ok && <span className="count">{lastCompile.errors || 1}</span>}
        </button>
        <button className={`panel-tab ${view === 'serial' ? 'active' : ''}`} onClick={() => setView('serial')}>
          <Plug size={13} />
          {t('panel.serial')}
          {monitor.running && <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />}
        </button>
        <button className={`panel-tab ${view === 'problems' ? 'active' : ''}`} onClick={() => setView('problems')}>
          <AlertTriangle size={13} />
          {t('panel.problems')}
          {errorCount > 0 && <span className="count">{errorCount}</span>}
        </button>
        <div className="panel-tools">
          {running && (
            <span className="row" style={{ gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
              <span className="spinner" />
              <span className="ellipsis" style={{ maxWidth: 220 }}>{progress?.detail || running.title}</span>
              <button className="icon-btn" title={t('panel.cancelRun')} onClick={() => void cancelRun()}>
                <CircleStop size={13} />
              </button>
            </span>
          )}
          {progress?.percent !== undefined && !running && (
            <span className="badge accent">{progress.percent}%</span>
          )}
          <button className="icon-btn" title={t('panel.copyAll')} onClick={() => void copyAll()}>
            <Copy size={13} />
          </button>
          <button
            className="icon-btn"
            title={view === 'serial' ? t('serial.clear') : t('panel.clearOutput')}
            onClick={() => (view === 'serial' ? useApp.getState().clearSerial() : clearOutput())}
          >
            <Trash2 size={13} />
          </button>
          <button className="icon-btn" title={t('panel.hide')} onClick={() => setPanelVisible(false)}>
            <X size={14} />
          </button>
        </div>
      </div>
      {running && progress?.percent !== undefined && (
        <div className="progress" style={{ borderRadius: 0, height: 2 }}>
          <div className="progress-bar" style={{ width: `${progress.percent}%` }} />
        </div>
      )}
      <div className="panel-body">
        {view === 'output' && <OutputView />}
        {view === 'serial' && <SerialView />}
        {view === 'problems' && <ProblemsView />}
      </div>
    </section>
  )
}
