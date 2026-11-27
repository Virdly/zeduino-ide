import { useEffect, useRef, useState } from 'react'
import { useApp } from './state/store'
import { Toolbar } from './components/Toolbar'
import { ActivityBar } from './components/ActivityBar'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { Welcome } from './components/Welcome'
import { BottomPanel } from './components/BottomPanel'
import { StatusBar, type CursorInfo } from './components/StatusBar'
import { ConfirmDialog, NewSketchDialog, PromptDialog, Toasts } from './components/Overlays'
import { CodeEditor } from './editor/CodeEditor'
import { AIChatPanel } from './ai/AIChatPanel'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { BoardManagerDialog } from './dialogs/BoardManagerDialog'
import { LibraryManagerDialog } from './dialogs/LibraryManagerDialog'
import { ThemeEditorDialog } from './dialogs/ThemeEditorDialog'
import { useT } from './i18n/useT'

let bootstrapped = false

export default function App() {
  const t = useT()
  const ready = useApp((s) => s.ready)
  const project = useApp((s) => s.project)
  const tabs = useApp((s) => s.tabs)
  const activePath = useApp((s) => s.activePath)
  const sidebarVisible = useApp((s) => s.sidebarVisible)
  const panelVisible = useApp((s) => s.panelVisible)
  const panelHeight = useApp((s) => s.panelHeight)
  const aiVisible = useApp((s) => s.aiVisible)
  const dialogs = useApp((s) => s.dialogs)
  const updateTabContent = useApp((s) => s.updateTabContent)
  const saveTab = useApp((s) => s.saveTab)
  const setPanelHeight = useApp((s) => s.setPanelHeight)
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, col: 1, sel: 0 })

  useEffect(() => {
    if (bootstrapped) return
    bootstrapped = true
    void useApp.getState().init()
  }, [])

  useEffect(() => {
    document.title = project ? `${project.name} — ZedArduino IDE` : 'ZedArduino IDE'
  }, [project])

  useEffect(() => {
    const anyDialog = () => {
      const s = useApp.getState()
      return s.dialogs.settings || s.dialogs.boards || s.dialogs.libraries
    }
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (anyDialog()) return
      const store = useApp.getState()
      const key = e.key.toLowerCase()
      if (key === 'b' && !e.shiftKey) {
        e.preventDefault()
        void store.compile()
      } else if (key === 'u') {
        e.preventDefault()
        void store.upload()
      } else if (key === 'm' && !e.shiftKey) {
        e.preventDefault()
        void store.toggleMonitor()
      } else if (key === 'a' && e.shiftKey) {
        e.preventDefault()
        store.setAiVisible(!store.aiVisible)
      } else if (key === 'e' && e.shiftKey) {
        e.preventDefault()
        store.setSidebarVisible(!store.sidebarVisible)
      } else if (key === '`') {
        e.preventDefault()
        store.setPanelVisible(!store.panelVisible)
      } else if (key === 'b' && e.shiftKey) {
        e.preventDefault()
        store.setDialog('boards', true)
      } else if (key === 'i' && e.shiftKey) {
        e.preventDefault()
        store.setDialog('libraries', true)
      } else if (key === ',') {
        e.preventDefault()
        store.setDialog('settings', true)
      } else if (key === 'f' && e.shiftKey) {
        e.preventDefault()
        store.setSidebarView('search')
      } else if (key === 's') {
        e.preventDefault()
        void store.saveAll()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const move = (e: MouseEvent) => {
      const height = window.innerHeight - e.clientY - 24
      setPanelHeight(height)
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'row-resize'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const activeTab = tabs.find((tab) => tab.path === activePath) || null

  if (!ready) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span className="spinner" style={{ width: 22, height: 22 }} />
          <span className="muted">{t('common.loading')}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <ActivityBar />
        {sidebarVisible && <Sidebar />}
        <div className="editor-col">
          <TabBar />
          <div className="editor-host">
            {activeTab ? (
              <CodeEditor
                key={activeTab.path}
                path={activeTab.path}
                value={activeTab.content}
                onChange={(content) => updateTabContent(activeTab.path, content)}
                onSave={() => void saveTab(activeTab.path)}
                onCursor={(line, col, sel) => setCursor({ line, col, sel })}
              />
            ) : (
              <Welcome />
            )}
          </div>
          {panelVisible && (
            <>
              <div className="splitter" onMouseDown={startResize} title={t('panel.output')} />
              <BottomPanel />
            </>
          )}
        </div>
        {aiVisible && (
          <div className="ai-panel">
            <AIChatPanel />
          </div>
        )}
      </div>
      <StatusBar cursor={cursor} />
      <PromptDialog />
      <ConfirmDialog />
      <NewSketchDialog />
      {dialogs.settings && <SettingsDialog />}
      {dialogs.boards && <BoardManagerDialog />}
      {dialogs.libraries && <LibraryManagerDialog />}
      {dialogs.theme && <ThemeEditorDialog />}
      <Toasts />
    </div>
  )
}
