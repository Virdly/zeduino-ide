import { createElement, memo, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { useT } from '../i18n/useT'

/* ------------------------------------------------------------------ clipboard */

/** Copy text with a small fallback for environments without the async clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the textarea fallback */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/* --------------------------------------------------------------- code block */

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="ai-code">
      <div className="ai-code-head">
        <span className="ai-code-lang">{lang || t('ai.code')}</span>
        <button
          type="button"
          className="btn ghost small ai-code-copy"
          title={copied ? t('ai.codeCopied') : t('ai.copyCode')}
          aria-label={copied ? t('ai.codeCopied') : t('ai.copyCode')}
          onClick={() => void copy()}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? t('ai.codeCopied') : t('ai.copyCode')}</span>
        </button>
      </div>
      <pre className="ai-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/* ------------------------------------------------------------ block parsing */

interface Fence {
  marker: string
  length: number
  lang: string
}

type MarkdownBlock =
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string }
  | { kind: 'hr' }

function matchFence(line: string): Fence | null {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return null
  const info = match[2].trim()
  const lang = info ? info.split(/\s+/)[0] : ''
  return { marker: match[1][0], length: match[1].length, lang }
}

function isClosingFence(line: string, marker: string, minLength: number): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed[0] !== marker) return false
  let count = 0
  while (count < trimmed.length && trimmed[count] === marker) count += 1
  return count >= minLength && trimmed.slice(count).trim() === ''
}

const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/
const LIST_RE = /^\s{0,3}([-*+]|\d+[.)])\s+(.*)$/

function isBlockStart(line: string): boolean {
  return !!matchFence(line) || HEADING_RE.test(line) || LIST_RE.test(line) || HR_RE.test(line)
}

function parseBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = matchFence(line)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !isClosingFence(lines[index], fence.marker, fence.length)) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ kind: 'code', lang: fence.lang, code: codeLines.join('\n') })
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      index += 1
      continue
    }

    if (HR_RE.test(line)) {
      blocks.push({ kind: 'hr' })
      index += 1
      continue
    }

    const listStart = LIST_RE.exec(line)
    if (listStart) {
      const ordered = /^\d/.test(listStart[1])
      const items: string[] = []
      while (index < lines.length) {
        const item = LIST_RE.exec(lines[index])
        if (!item || /^\d/.test(item[1]) !== ordered) break
        items.push(item[2])
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index]
      if (!next.trim() || isBlockStart(next)) break
      paragraph.push(next)
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
  }

  return blocks
}

/* ------------------------------------------------------------ inline parsing */

function isWordChar(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_]/u.test(char)
}

function findClosing(text: string, marker: string, from: number): number {
  let index = text.indexOf(marker, from)
  while (index !== -1) {
    const escaped = index > 0 && text[index - 1] === '\\'
    const insideWord =
      marker === '_' && isWordChar(text[index - 1]) && isWordChar(text[index + 1])
    if (!escaped && !insideWord) return index
    index = text.indexOf(marker, index + marker.length)
  }
  return -1
}

function canOpenItalic(text: string, index: number): boolean {
  const next = text[index + 1]
  if (!next || /\s/.test(next)) return false
  if (index > 0 && isWordChar(text[index - 1])) return false
  return true
}

function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = []
  let buffer = ''
  let index = 0
  let keyIndex = 0

  const nextKey = (tag: string) => `${keyPrefix}${tag}${keyIndex++}`
  const flush = () => {
    if (buffer) {
      nodes.push(buffer)
      buffer = ''
    }
  }

  while (index < text.length) {
    const char = text[index]

    if (char === '`') {
      const end = text.indexOf('`', index + 1)
      if (end > index + 1) {
        flush()
        nodes.push(
          <code key={nextKey('c')} className="ai-md-code">
            {text.slice(index + 1, end)}
          </code>,
        )
        index = end + 1
        continue
      }
    }

    if (char === '[') {
      const closeBracket = text.indexOf(']', index + 1)
      if (closeBracket > index && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2)
        if (closeParen > closeBracket) {
          const label = text.slice(index + 1, closeBracket)
          const url = text.slice(closeBracket + 2, closeParen).trim()
          if (label && /^https?:\/\//i.test(url)) {
            flush()
            const key = nextKey('a')
            nodes.push(
              <a
                key={key}
                className="ai-md-link"
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(event) => {
                  event.preventDefault()
                  void window.api.app.openExternal(url)
                }}
              >
                {renderInline(label, `${key}-`)}
              </a>,
            )
            index = closeParen + 1
            continue
          }
        }
      }
    }

    if (char === '*' || char === '_') {
      const marker = char + char
      if (text.startsWith(marker, index)) {
        const end = findClosing(text, marker, index + 2)
        if (end > index + 2) {
          flush()
          const key = nextKey('b')
          nodes.push(
            <strong key={key}>{renderInline(text.slice(index + 2, end), `${key}-`)}</strong>,
          )
          index = end + 2
          continue
        }
      } else if (canOpenItalic(text, index)) {
        const end = findClosing(text, char, index + 1)
        if (end > index + 1 && !/\s/.test(text[end - 1] || '')) {
          flush()
          const key = nextKey('e')
          nodes.push(<em key={key}>{renderInline(text.slice(index + 1, end), `${key}-`)}</em>)
          index = end + 1
          continue
        }
      }
    }

    if (char === '\n') {
      flush()
      nodes.push(<br key={nextKey('br')} />)
      index += 1
      continue
    }

    buffer += char
    index += 1
  }

  flush()
  return nodes
}

/* ----------------------------------------------------------------- renderer */

function MarkdownView({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text])

  if (!blocks.length) return null

  return (
    <div className="ai-md">
      {blocks.map((block, blockIndex) => {
        const key = `b${blockIndex}`

        if (block.kind === 'code') {
          return <CodeBlock key={key} code={block.code} lang={block.lang} />
        }

        if (block.kind === 'heading') {
          const level = Math.min(6, Math.max(1, block.level))
          return createElement(
            `h${level}`,
            { key, className: `ai-md-title ai-md-h${level}` },
            renderInline(block.text, `${key}-`),
          )
        }

        if (block.kind === 'list') {
          const items = block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}-`)}</li>
          ))
          return block.ordered ? (
            <ol key={key} className="ai-md-list">
              {items}
            </ol>
          ) : (
            <ul key={key} className="ai-md-list">
              {items}
            </ul>
          )
        }

        if (block.kind === 'hr') {
          return <hr key={key} className="ai-md-hr" />
        }

        return (
          <p key={key} className="ai-md-p">
            {renderInline(block.text, `${key}-`)}
          </p>
        )
      })}
    </div>
  )
}

export const Markdown = memo(MarkdownView)
