import { ChevronRight, File, FileCode2, FileJson, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from 'lucide-react'
import type { FileNode } from '../../shared/types'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'

function iconFor(node: FileNode) {
  if (node.type === 'dir') return null
  const ext = node.ext || ''
  if (['.ino', '.pde', '.h', '.hpp', '.c', '.cpp', '.cc', '.cxx', '.hxx'].includes(ext)) return <FileCode2 size={13} />
  if (ext === '.json' || ext === '.yml' || ext === '.yaml') return <FileJson size={13} />
  if (['.md', '.txt', '.csv'].includes(ext)) return <FileText size={13} />
  return <File size={13} />
}

interface TreeProps {
  nodes: FileNode[]
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  selectedDir: string
  onSelectDir: (path: string) => void
}

export function FileTree({ nodes, depth, expanded, onToggle, selectedDir, onSelectDir }: TreeProps) {
  const t = useT()
  const activePath = useApp((s) => s.activePath)
  const openFile = useApp((s) => s.openFile)
  const tabs = useApp((s) => s.tabs)
  const createEntry = useApp((s) => s.createEntry)
  const renameEntry = useApp((s) => s.renameEntry)
  const deleteEntry = useApp((s) => s.deleteEntry)
  const revealEntry = useApp((s) => s.revealEntry)

  return (
    <>
      {nodes.map((node) => {
        const isDir = node.type === 'dir'
        const open = expanded.has(node.path)
        const active = activePath === node.path
        const selected = isDir && selectedDir === node.path
        const dirty = tabs.some((tab) => tab.path === node.path && tab.content !== tab.saved)
        return (
          <div key={node.path}>
            <div
              className={`tree-row ${isDir ? 'dir' : ''} ${active || selected ? 'selected' : ''}`}
              style={{ paddingLeft: 6 + depth * 12 }}
              title={node.path}
              onClick={() => {
                if (isDir) {
                  onSelectDir(node.path)
                  onToggle(node.path)
                } else {
                  onSelectDir(node.path.slice(0, node.path.lastIndexOf('/')) || '')
                  void openFile(node.path)
                }
              }}
              onDoubleClick={() => {
                if (!isDir) void revealEntry(node.path)
              }}
            >
              {isDir ? (
                <span className={`chevron ${open ? 'open' : ''}`}>
                  <ChevronRight size={12} />
                </span>
              ) : (
                <span style={{ width: 14 }} />
              )}
              <span className="ficon" style={{ color: active ? 'var(--accent)' : undefined }}>
                {isDir ? open ? <FolderOpen size={13} /> : <Folder size={13} /> : iconFor(node)}
              </span>
              <span className="label">{node.name}</span>
              {dirty && <span className="dirty" />}
              <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                {isDir && (
                  <>
                    <button className="icon-btn" title={t('explorer.newFile')} onClick={() => void createEntry('file', node.path)}>
                      <FilePlus2 size={12} />
                    </button>
                    <button className="icon-btn" title={t('explorer.newFolder')} onClick={() => void createEntry('folder', node.path)}>
                      <FolderPlus size={12} />
                    </button>
                  </>
                )}
                <button className="icon-btn" title={t('explorer.rename')} onClick={() => void renameEntry(node.path, node.name)}>
                  <Pencil size={12} />
                </button>
                <button className="icon-btn" title={t('explorer.delete')} onClick={() => void deleteEntry(node.path, node.name)}>
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
            {isDir && open && node.children && node.children.length > 0 && (
              <FileTree
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selectedDir={selectedDir}
                onSelectDir={onSelectDir}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
