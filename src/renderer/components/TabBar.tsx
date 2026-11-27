import { FileCode2, X } from 'lucide-react'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'

export function TabBar() {
  const t = useT()
  const tabs = useApp((s) => s.tabs)
  const activePath = useApp((s) => s.activePath)
  const activate = useApp((s) => s.activateTab)
  const closeTab = useApp((s) => s.closeTab)
  const saveTab = useApp((s) => s.saveTab)

  if (!tabs.length) return null

  return (
    <div className="tabbar">
      {tabs.map((tab) => {
        const active = tab.path === activePath
        const dirty = tab.content !== tab.saved
        return (
          <div
            key={tab.path}
            className={`tab ${active ? 'active' : ''}`}
            title={tab.path}
            onClick={() => activate(tab.path)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                void closeTab(tab.path)
              }
            }}
          >
            <FileCode2 size={13} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)', flex: 'none' }} />
            <span className="tab-name">{tab.name}</span>
            {dirty ? (
              <button
                className="tab-close"
                title={`${t('toolbar.save')} · ${t('tabs.unsaved')}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void saveTab(tab.path)
                }}
              >
                <span className="dirty-dot" />
              </button>
            ) : (
              <button
                className="tab-close"
                title={t('tabs.close')}
                onClick={(e) => {
                  e.stopPropagation()
                  void closeTab(tab.path)
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
