import { CircuitBoard, Files, Library, Search, Settings, Sparkles } from 'lucide-react'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'

export function ActivityBar() {
  const t = useT()
  const view = useApp((s) => s.sidebarView)
  const visible = useApp((s) => s.sidebarVisible)
  const aiVisible = useApp((s) => s.aiVisible)
  const setView = useApp((s) => s.setSidebarView)
  const setSidebarVisible = useApp((s) => s.setSidebarVisible)
  const setDialog = useApp((s) => s.setDialog)
  const setAiVisible = useApp((s) => s.setAiVisible)
  const problems = useApp((s) => s.problems)
  const errorCount = problems.filter((p) => p.severity === 'error').length

  const toggle = (target: 'files' | 'search') => {
    if (visible && view === target) setSidebarVisible(false)
    else setView(target)
  }

  return (
    <nav className="activitybar">
      <button
        className={`act-btn ${visible && view === 'files' ? 'active' : ''}`}
        title={t('activity.files')}
        onClick={() => toggle('files')}
      >
        <Files size={19} />
        {errorCount > 0 && <span className="dot" style={{ background: 'var(--error)' }} />}
      </button>
      <button
        className={`act-btn ${visible && view === 'search' ? 'active' : ''}`}
        title={t('activity.search')}
        onClick={() => toggle('search')}
      >
        <Search size={18} />
      </button>
      <button className="act-btn" title={t('activity.boards')} onClick={() => setDialog('boards', true)}>
        <CircuitBoard size={19} />
      </button>
      <button className="act-btn" title={t('activity.libraries')} onClick={() => setDialog('libraries', true)}>
        <Library size={18} />
      </button>
      <button
        className={`act-btn ${aiVisible ? 'active' : ''}`}
        title={t('activity.ai')}
        onClick={() => setAiVisible(!aiVisible)}
      >
        <Sparkles size={18} />
      </button>
      <div className="spacer" />
      <button className="act-btn" title={t('activity.settings')} onClick={() => setDialog('settings', true)}>
        <Settings size={18} />
      </button>
    </nav>
  )
}
