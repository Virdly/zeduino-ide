import { ChevronLeft, ChevronRight, FilePlus2, FolderOpen, FolderPlus, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'
import { FileTree } from './FileTree'

function SearchView() {
  const t = useT()
  const query = useApp((s) => s.searchQuery)
  const results = useApp((s) => s.searchResults)
  const busy = useApp((s) => s.searchBusy)
  const setSearchQuery = useApp((s) => s.setSearchQuery)
  const openFile = useApp((s) => s.openFile)
  const project = useApp((s) => s.project)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const grouped = useMemo(() => {
    const map = new Map<string, typeof results>()
    for (const item of results) {
      const list = map.get(item.path) || []
      list.push(item)
      map.set(item.path, list)
    }
    return [...map.entries()]
  }, [results])

  const jump = async (path: string, line: number, column: number) => {
    await openFile(path)
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('zeduino:editor', { detail: { action: 'goto', line, column } }))
    }, 60)
  }

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">{t('activity.search')}</span>
      </div>
      <div className="search-box">
        <div className="search-input-wrap">
          <Search size={13} />
          <input
            ref={inputRef}
            className="input"
            value={query}
            placeholder={t('explorer.searchPlaceholder')}
            onChange={(e) => void setSearchQuery(e.target.value)}
          />
          {query && (
            <button
              className="icon-btn sm"
              style={{ position: 'absolute', right: 3, top: 4 }}
              onClick={() => void setSearchQuery('')}
              title={t('common.reset')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {busy && <span className="spinner" />}
      </div>
      <div className="sidebar-body">
        {!project && <div className="sidebar-empty">{t('explorer.noProject')}</div>}
        {project && query.trim().length < 2 && <div className="sidebar-empty">{t('explorer.searchEmpty')}</div>}
        {project && query.trim().length >= 2 && !busy && results.length === 0 && (
          <div className="sidebar-empty">{t('explorer.noResults')}</div>
        )}
        {grouped.map(([path, items]) => (
          <div key={path} style={{ marginBottom: 6 }}>
            <div
              className="search-result"
              style={{ cursor: 'pointer', paddingBottom: 2 }}
              onClick={() => void jump(path, items[0].line, items[0].column)}
            >
              <span className="file">
                <ChevronRight size={11} />
                <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{path}</span>
                <span className="badge">{items.length}</span>
              </span>
            </div>
            {items.slice(0, 30).map((item) => (
              <div
                key={`${item.path}:${item.line}:${item.column}`}
                className="search-result"
                style={{ paddingLeft: 22 }}
                onClick={() => void jump(item.path, item.line, item.column)}
                title={`${item.path}:${item.line}`}
              >
                <span className="preview">
                  <span style={{ color: 'var(--text-muted)' }}>{item.line}: </span>
                  {item.preview.length > 140 ? `${item.preview.slice(0, 140)}…` : item.preview}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

function FilesView() {
  const t = useT()
  const project = useApp((s) => s.project)
  const tree = useApp((s) => s.tree)
  const recent = useApp((s) => s.recent)
  const activePath = useApp((s) => s.activePath)
  const openFile = useApp((s) => s.openFile)
  const refreshTree = useApp((s) => s.refreshTree)
  const createEntry = useApp((s) => s.createEntry)
  const projectOpen = useApp((s) => s.projectOpen)
  const projectOpenDialog = useApp((s) => s.projectOpenDialog)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedDir, setSelectedDir] = useState('')

  useEffect(() => {
    if (!activePath) return
    const parts = activePath.split('/')
    if (parts.length < 2) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'))
      return next
    })
  }, [activePath])

  useEffect(() => {
    setExpanded(new Set())
    setSelectedDir('')
  }, [project?.root])

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">{t('explorer.title')}</span>
        <div className="spacer" />
        <button
          className="icon-btn"
          title={t('explorer.newFile')}
          onClick={() => void createEntry('file', selectedDir)}
          disabled={!project}
        >
          <FilePlus2 size={14} />
        </button>
        <button
          className="icon-btn"
          title={t('explorer.newFolder')}
          onClick={() => void createEntry('folder', selectedDir)}
          disabled={!project}
        >
          <FolderPlus size={14} />
        </button>
        <button className="icon-btn" title={t('explorer.refresh')} onClick={() => void refreshTree()} disabled={!project}>
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="sidebar-body">
        {!project ? (
          <div className="sidebar-empty">
            <div>{t('explorer.noProject')}</div>
            <button className="btn primary" onClick={() => void projectOpenDialog()}>
              <FolderOpen size={14} /> {t('explorer.openFolder')}
            </button>
            {recent.length > 0 && (
              <>
                <div className="sidebar-title" style={{ marginTop: 6 }}>{t('explorer.recent')}</div>
                {recent.map((root) => (
                  <div
                    key={root}
                    className="recent-row"
                    style={{ width: '100%', padding: '5px 6px' }}
                    onClick={() => void projectOpen(root)}
                    title={root}
                  >
                    <FolderOpen size={13} style={{ color: 'var(--warning)' }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12 }}>{root.split(/[\\/]/).filter(Boolean).pop()}</div>
                      <div className="path" title={root}>{root}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <FileTree
            nodes={tree}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            selectedDir={selectedDir}
            onSelectDir={setSelectedDir}
          />
        )}
      </div>
      {project && selectedDir && (
        <div className="sidebar-header" style={{ borderTop: '1px solid var(--border)', minHeight: 28 }}>
          <button className="icon-btn" title={t('common.open')} onClick={() => setSelectedDir('')}>
            <ChevronLeft size={13} />
          </button>
          <span className="ellipsis muted" style={{ fontSize: 11 }}>
            {t('explorer.createIn', { dir: selectedDir })}
          </span>
        </div>
      )}
      {project && !selectedDir && (
        <div className="sidebar-header" style={{ borderTop: '1px solid var(--border)', minHeight: 28 }}>
          <span className="ellipsis muted" style={{ fontSize: 11 }}>
            {project.root}
          </span>
        </div>
      )}
    </>
  )
}

export function Sidebar() {
  const view = useApp((s) => s.sidebarView)
  return <aside className="sidebar">{view === 'search' ? <SearchView /> : <FilesView />}</aside>
}
