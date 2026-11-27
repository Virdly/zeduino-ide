import { ArrowRight, Cpu, Download, FolderOpen, Plus, Sparkles } from 'lucide-react'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'

export function Welcome() {
  const t = useT()
  const recent = useApp((s) => s.recent)
  const cliStatus = useApp((s) => s.cliStatus)
  const projectOpenDialog = useApp((s) => s.projectOpenDialog)
  const projectOpen = useApp((s) => s.projectOpen)
  const setDialog = useApp((s) => s.setDialog)
  const ensureCli = useApp((s) => s.ensureCli)
  const progress = useApp((s) => s.progress)

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-mark">
          <Cpu size={24} strokeWidth={2.4} />
        </div>
        <div>
          <h1>{t('welcome.title')}</h1>
          <p className="sub">{t('welcome.subtitle')}</p>
        </div>

        <div className="welcome-actions">
          <button className="btn primary lg" onClick={() => void projectOpenDialog()}>
            <FolderOpen size={15} /> {t('welcome.openFolder')}
          </button>
          <button className="btn lg" onClick={() => setDialog('newSketch', true)}>
            <Plus size={15} /> {t('welcome.newSketch')}
          </button>
          <button className="btn lg" onClick={() => useApp.getState().setAiVisible(true)}>
            <Sparkles size={15} /> {t('toolbar.ai')}
          </button>
        </div>

        {!cliStatus?.installed && (
          <div className="welcome-box" style={{ borderColor: 'var(--warning)' }}>
            <h2>{t('status.cliMissing')}</h2>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 12 }}>
                {t('welcome.needCli')}
              </span>
              <button className="btn small primary" onClick={() => void ensureCli()} disabled={!!progress}>
                {progress ? <span className="spinner" /> : <Download size={13} />} {t('welcome.setupCli')}
              </button>
            </div>
          </div>
        )}

        <div className="welcome-grid">
          <div className="welcome-box">
            <h2>{t('welcome.recent')}</h2>
            {recent.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>{t('welcome.noRecent')}</p>
            ) : (
              recent.slice(0, 6).map((root) => (
                <div key={root} className="recent-row" onClick={() => void projectOpen(root)} title={root}>
                  <FolderOpen size={13} style={{ color: 'var(--warning)', flex: 'none' }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="ellipsis">{root.split(/[\\/]/).filter(Boolean).pop()}</div>
                    <div className="path" title={root}>{root}</div>
                  </div>
                  <ArrowRight size={12} className="muted" />
                </div>
              ))
            )}
          </div>
          <div className="welcome-box">
            <h2>{t('welcome.gettingStarted')}</h2>
            {[
              ['1', t('welcome.tipOpen')],
              ['2', t('welcome.tipBoard')],
              ['3', t('welcome.tipBuild')],
              ['4', t('welcome.tipMonitor')],
            ].map(([num, text]) => (
              <div className="tip-row" key={num}>
                <span className="num">{num}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="row muted" style={{ fontSize: 11.5, gap: 14, flexWrap: 'wrap' }}>
          <span>{t('welcome.hint')}</span>
          <span>{t('welcome.features')}</span>
        </div>
      </div>
    </div>
  )
}
