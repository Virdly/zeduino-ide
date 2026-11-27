import { ChevronDown, Cpu, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/store'
import { useT } from '../i18n/useT'

export function BoardPicker() {
  const t = useT()
  const boards = useApp((s) => s.boards)
  const fqbn = useApp((s) => s.settings.arduino.fqbn)
  const boardOptions = useApp((s) => s.settings.arduino.boardOptions)
  const setBoard = useApp((s) => s.setBoard)
  const setDialog = useApp((s) => s.setDialog)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const current = boards.find((board) => board.fqbn === fqbn)
  const optionCount = Object.keys(boardOptions || {}).filter((k) => boardOptions[k]).length

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    const timer = setTimeout(() => inputRef.current?.focus(), 10)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return boards
    const words = needle.split(/\s+/)
    return boards.filter((board) => {
      const haystack = `${board.name} ${board.fqbn}`.toLowerCase()
      return words.every((word) => haystack.includes(word))
    })
  }, [boards, query])

  const pick = (value: string) => {
    void setBoard(value)
    setOpen(false)
  }

  return (
    <div className="board-picker-wrap" ref={wrapRef}>
      <button
        className={`board-button ${open ? 'open' : ''}`}
        title={current ? `${current.name} (${current.fqbn})` : t('toolbar.boardTip')}
        onClick={() => setOpen((v) => !v)}
        disabled={!boards.length}
      >
        <Cpu size={13} className="board-icon" />
        <span className="board-button-name">{current ? current.name : boards.length ? t('toolbar.selectBoard') : t('toolbar.noBoards')}</span>
        <ChevronDown size={12} className="board-chevron" />
      </button>
      {optionCount > 0 && (
        <button
          className="icon-btn"
          title={t('toolbar.boardOptions')}
          onClick={() => setDialog('boards', true)}
        >
          <span className="badge accent">{optionCount}</span>
        </button>
      )}
      {open && (
        <div className="board-popover">
          <div className="board-search">
            <Search size={13} />
            <input
              ref={inputRef}
              value={query}
              placeholder={t('toolbar.boardSearch')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && filtered[0]) pick(filtered[0].fqbn)
              }}
            />
            <span className="badge">{filtered.length}</span>
          </div>
          <div className="board-list">
            {filtered.length === 0 && <div className="board-empty">{t('common.nothingFound')}</div>}
            {filtered.slice(0, 300).map((board) => (
              <button
                key={board.fqbn}
                className={`board-row ${board.fqbn === fqbn ? 'current' : ''}`}
                onClick={() => pick(board.fqbn)}
                title={board.fqbn}
              >
                <span className="board-row-name">{board.name}</span>
                <span className="board-row-meta mono">{board.fqbn}</span>
              </button>
            ))}
          </div>
          <div className="board-popover-footer">
            <span>{t('toolbar.boardsFound', { count: boards.length })}</span>
            <button className="link-btn" onClick={() => { setOpen(false); setDialog('boards', true) }}>
              {t('toolbar.boards')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
