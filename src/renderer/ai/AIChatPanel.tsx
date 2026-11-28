import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe,
  KeyRound,
  Library,
  ListChecks,
  Pencil,
  Play,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import type { AiPlan, AiToolCall, ChatMessage } from '../../shared/types'
import type { TranslateFn } from '../i18n'
import { useT } from '../i18n/useT'
import { useApp } from '../state/store'
import { Markdown, copyText } from './Markdown'
import {
  REJECTED_TOOL_CONTENT,
  useAiChat,
  type PendingToolBatch,
  type ToolDecision,
} from './useAiChat'
import './ai.css'

/* ------------------------------------------------------------------ helpers */

function parseArgsForDisplay(raw: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  const text = raw?.trim() ? raw.trim() : '{}'
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'JSON object expected' }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function toolLabel(t: TranslateFn, name: string): string {
  const key = `ai.tool.${name}`
  const label = t(key)
  return label === key ? t('ai.tool.unknown') : label
}

function toolDescription(t: TranslateFn, name: string): string {
  const key = `ai.tool.${name}.desc`
  const description = t(key)
  return description === key ? t('ai.tool.unknownDesc') : description
}

function friendlyApiError(t: TranslateFn, raw: string): string {
  const text = (raw || '').trim()
  if (!text) return t('ai.errors.unknown')
  if (/Не указан API-ключ/i.test(text)) return t('ai.errors.noApiKey')
  if (/Не указан адрес API/i.test(text)) return t('ai.errors.noBaseUrl')
  if (/Не указана модель/i.test(text)) return t('ai.errors.noModel')
  if (/Проект не открыт/i.test(text)) return t('ai.errors.noProject')
  if (/Путь вне папки проекта/i.test(text)) return t('ai.errors.sandbox')
  return text
}

function friendlyToolError(t: TranslateFn, raw: string): string {
  const text = (raw || '').trim()
  if (!text) return t('ai.errors.unknown')
  if (/Путь вне папки проекта/i.test(text)) return t('ai.errors.sandbox')
  if (/Проект не открыт/i.test(text)) return t('ai.errors.noProject')
  if (/Файл уже существует/i.test(text)) return t('ai.errors.fileExists')
  if (/ENOENT|no such file|не удалось найти/i.test(text)) return t('ai.errors.fileNotFound')
  if (/слишком большой/i.test(text)) return t('ai.errors.fileTooLarge')
  return text
}

function requiresProject(name: string): boolean {
  return !['web_search', 'web_fetch', 'list_libraries', 'update_plan'].includes(name)
}

function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case 'read_file':
      return <FileText size={13} />
    case 'edit_file':
      return <Wrench size={13} />
    case 'write_file':
      return <Pencil size={13} />
    case 'create_file':
      return <FilePlus2 size={13} />
    case 'delete_file':
      return <Trash2 size={13} />
    case 'list_dir':
      return <FolderOpen size={13} />
    case 'list_libraries':
      return <Library size={13} />
    case 'run_python':
      return <Play size={13} />
    case 'run_shell':
      return <SquareTerminal size={13} />
    case 'web_search':
    case 'web_fetch':
      return <Globe size={13} />
    case 'update_plan':
      return <ListChecks size={13} />
    default:
      return <Settings size={13} />
  }
}

/* -------------------------------------------------------------------- pieces */

function SetupCard({
  baseUrl,
  model,
  onOpen,
}: {
  baseUrl: string
  model: string
  onOpen: () => void
}) {
  const t = useT()
  return (
    <section className="ai-setup" aria-labelledby="ai-setup-title">
      <KeyRound size={16} className="ai-setup-icon" aria-hidden="true" />
      <div className="ai-setup-body">
        <div className="ai-setup-title" id="ai-setup-title">
          {t('ai.setup.title')}
        </div>
        <div className="ai-setup-text">{t('ai.setup.body')}</div>
        <div className="ai-setup-hint">{t('ai.setup.hint')}</div>
        <div className="ai-setup-provider">
          {t('ai.setup.provider', {
            baseUrl: baseUrl || '—',
            model: model || t('ai.modelNone'),
          })}
        </div>
        <button type="button" className="btn primary small" onClick={onOpen}>
          <Settings size={12} />
          {t('ai.setup.open')}
        </button>
      </div>
    </section>
  )
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  const t = useT()
  const examples = useMemo(
    () => [
      t('ai.example.explain'),
      t('ai.example.sensor'),
      t('ai.example.compile'),
      t('ai.example.config'),
    ],
    [t],
  )

  return (
    <div className="ai-empty">
      <div className="ai-empty-icon">
        <Sparkles size={17} />
      </div>
      <div>
        <h2>{t('ai.empty.title')}</h2>
        <p className="ai-empty-text">{t('ai.empty.body')}</p>
      </div>
      <div className="ai-examples-title">{t('ai.examples')}</div>
      <div className="ai-chips">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            className="ai-chip"
            onClick={() => onPick(example)}
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageCopyButton({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      className="icon-btn sm ai-copy"
      title={copied ? t('ai.copied') : t('ai.copy')}
      aria-label={copied ? t('ai.copied') : t('ai.copy')}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (ok) setCopied(true)
        })
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="ai-typing" role="status" aria-label={label}>
      <span className="ai-typing-dot" />
      <span className="ai-typing-dot" />
      <span className="ai-typing-dot" />
    </div>
  )
}

function UserMessage({ message }: { message: ChatMessage }) {
  const t = useT()
  return (
    <div className="ai-msg ai-msg-user">
      <div className="ai-msg-meta">
        <MessageCopyButton text={message.content} />
        <span className="ai-msg-role">{t('ai.you')}</span>
      </div>
      <div className="ai-bubble-user">{message.content}</div>
    </div>
  )
}

interface ToolCallCardProps {
  call: AiToolCall
  batch: PendingToolBatch | null
  resultMessage: ChatMessage | undefined
  projectOpen: boolean
  onApprove: (callId: string) => void
  onReject: (callId: string) => void
}

function ToolCallCard({
  call,
  batch,
  resultMessage,
  projectOpen,
  onApprove,
  onReject,
}: ToolCallCardProps) {
  const t = useT()
  const projectRoot = useApp((state) => state.project?.root || '')
  const parsed = useMemo(() => parseArgsForDisplay(call.arguments), [call.arguments])
  const argsText = useMemo(
    () => (parsed.ok ? JSON.stringify(parsed.value, null, 2) : call.arguments || '{}'),
    [parsed, call.arguments],
  )
  const longArgs = argsText.length > 600 || (argsText.includes('\n') && argsText.length > 300)
  const [argsExpanded, setArgsExpanded] = useState<boolean | null>(null)
  const showArgs = argsExpanded ?? !longArgs
  const [resultExpanded, setResultExpanded] = useState(false)

  const active = batch !== null
  const decision: ToolDecision | undefined = batch ? batch.decisions[call.id] : undefined
  const pending = active && (decision === 'pending' || decision === undefined)
  const running = decision === 'running'
  const rejected = batch
    ? decision === 'rejected'
    : resultMessage?.content === REJECTED_TOOL_CONTENT

  let statusView: { label: string; className: string } | null = null
  if (active) {
    if (pending) statusView = { label: t('ai.tool.status.pending'), className: 'badge warning' }
    else if (running) statusView = { label: t('ai.tool.status.running'), className: 'badge' }
    else if (decision === 'approved')
      statusView = { label: t('ai.tool.status.approved'), className: 'badge success' }
    else if (decision === 'error')
      statusView = { label: t('ai.tool.status.error'), className: 'badge error' }
    else if (decision === 'rejected')
      statusView = { label: t('ai.tool.status.rejected'), className: 'badge' }
  } else if (resultMessage) {
    if (resultMessage.content === REJECTED_TOOL_CONTENT) {
      statusView = { label: t('ai.tool.status.rejected'), className: 'badge' }
    } else if (resultMessage.error) {
      statusView = { label: t('ai.tool.status.error'), className: 'badge error' }
    } else {
      statusView = { label: t('ai.tool.status.done'), className: 'badge success' }
    }
  }

  let resultContent: string | null = null
  let resultIsError = false
  if (batch) {
    const result = batch.results[call.id]
    if (result && !rejected) {
      resultContent = result.content
      resultIsError = !result.ok
    }
  } else if (resultMessage && !rejected) {
    resultContent = resultMessage.content
    resultIsError = !!resultMessage.error
  }

  const rawPath =
    parsed.ok && typeof parsed.value.path === 'string' ? parsed.value.path.trim() : ''
  const command = parsed.ok && typeof parsed.value.command === 'string' ? parsed.value.command.trim() : ''
  const code = parsed.ok && typeof parsed.value.code === 'string' ? parsed.value.code.trim() : ''
  const query = parsed.ok && typeof parsed.value.query === 'string' ? parsed.value.query.trim() : ''
  const fetchUrl = parsed.ok && typeof parsed.value.url === 'string' ? parsed.value.url.trim() : ''
  const filter = parsed.ok && typeof parsed.value.filter === 'string' ? parsed.value.filter.trim() : ''
  const targetValue = rawPath || command || fetchUrl || query || filter || (code ? code.split('\n')[0] : '')
  const targetPreview = targetValue.length > 120 ? `${targetValue.slice(0, 120)}…` : targetValue
  const absoluteOutside =
    !!rawPath &&
    (/^[a-zA-Z]:[\\/]/.test(rawPath) || rawPath.startsWith('/')) &&
    !(projectRoot && rawPath.toLowerCase().startsWith(projectRoot.toLowerCase()))
  const dangerous = call.name === 'delete_file' || call.name === 'run_shell' || call.name === 'run_python'
  const targetLabel =
    call.name === 'run_shell'
      ? t('ai.tool.command')
      : call.name === 'run_python'
        ? t('ai.tool.script')
        : call.name === 'web_search'
          ? t('ai.tool.query')
          : call.name === 'web_fetch'
            ? t('ai.tool.url')
            : call.name === 'list_libraries'
              ? t('ai.tool.filter')
              : call.name === 'update_plan'
                ? t('ai.tool.plan')
                : t('ai.tool.path')
  const shortResult =
    resultContent !== null &&
    !resultIsError &&
    resultContent.length <= 280 &&
    !resultContent.includes('\n')
  const resultHeadVisible = resultContent !== null
  const resultBodyVisible =
    resultContent !== null && (resultIsError || shortResult || resultExpanded)
  const actionsVisible =
    active && (pending || running || (requiresProject(call.name) && !projectOpen) || !parsed.ok)

  return (
    <div className={`ai-tool${dangerous ? ' danger' : ''}`}>
      <div className="ai-tool-head">
        <span className="ai-tool-icon">
          <ToolIcon name={call.name} />
        </span>
        <div className="ai-tool-titles">
          <span className="ai-tool-name">
            {toolLabel(t, call.name)}
            <span className="ai-tool-code"> {call.name}</span>
          </span>
          <span className="ai-tool-desc">{toolDescription(t, call.name)}</span>
        </div>
        {statusView && <span className={statusView.className}>{statusView.label}</span>}
      </div>

      <div className="ai-tool-path">
        <span className="ai-tool-path-label">{targetLabel}:</span>
        <code title={targetValue}>{targetPreview || t('ai.tool.root')}</code>
      </div>

      {(dangerous || absoluteOutside) && (
        <div className="ai-tool-warnings">
          {dangerous && (
            <span className="ai-tool-warn danger">
              <AlertTriangle size={11} />
              {t('ai.tool.danger')}
            </span>
          )}
          {absoluteOutside && (
            <span className="ai-tool-warn">
              <Library size={11} />
              {t('ai.tool.outsideProject')}
            </span>
          )}
        </div>
      )}

      <div className="ai-tool-args-head">
        {longArgs ? (
          <button
            type="button"
            className="ai-linkbtn"
            aria-expanded={showArgs}
            onClick={() => setArgsExpanded(!showArgs)}
          >
            {showArgs ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {showArgs
              ? t('ai.tool.hideArgs')
              : t('ai.tool.showArgs', { count: argsText.length })}
          </button>
        ) : (
          <span>{t('ai.tool.args')}</span>
        )}
      </div>
      {showArgs && <pre className="ai-tool-args">{argsText}</pre>}

      {actionsVisible && (
        <div className="ai-tool-actions">
          {pending && (
            <>
              <button
                type="button"
                className="btn small primary"
                disabled={(requiresProject(call.name) && !projectOpen) || !parsed.ok || !!batch?.executing}
                title={requiresProject(call.name) && !projectOpen ? t('ai.toolsDisabled') : undefined}
                onClick={() => onApprove(call.id)}
              >
                {t('ai.tool.approve')}
              </button>
              <button
                type="button"
                className="btn small"
                disabled={!!batch?.executing}
                onClick={() => onReject(call.id)}
              >
                {t('ai.tool.reject')}
              </button>
            </>
          )}
          {running && (
            <span className="ai-tool-running">
              <span className="spinner" />
              {t('ai.tool.status.running')}
            </span>
          )}
          {active && requiresProject(call.name) && !projectOpen && (
            <span className="ai-tool-note">{t('ai.toolsDisabled')}</span>
          )}
          {active && !parsed.ok && (
            <span className="ai-tool-note">{t('ai.tool.argsInvalid')}</span>
          )}
        </div>
      )}

      {resultHeadVisible && (
        <div className="ai-tool-result-head">
          <span>{t('ai.tool.result')}</span>
          {!resultIsError && !shortResult && (
            <button
              type="button"
              className="ai-linkbtn"
              aria-expanded={resultExpanded}
              onClick={() => setResultExpanded(!resultExpanded)}
            >
              {resultExpanded ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronRight size={11} />
              )}
              {resultExpanded
                ? t('ai.tool.hideResult')
                : t('ai.tool.showResult', { count: resultContent?.length ?? 0 })}
            </button>
          )}
        </div>
      )}
      {resultBodyVisible && (
        <pre className={`ai-tool-result${resultIsError ? ' error' : ''}`}>
          {resultIsError
            ? friendlyToolError(t, resultContent || '')
            : resultContent || t('ai.tool.empty')}
        </pre>
      )}
    </div>
  )
}

function PlanPanel({ plan }: { plan: AiPlan | null }) {
  const t = useT()
  if (!plan || !plan.steps.length) return null
  const done = plan.steps.filter((step) => step.status === 'done').length
  const percent = Math.round((done / plan.steps.length) * 100)

  return (
    <section className="ai-plan" aria-label={t('ai.plan.title')}>
      <div className="ai-plan-head">
        <span className="ai-plan-head-icon">
          <ListChecks size={14} />
        </span>
        <span className="ai-plan-head-title" title={plan.title}>
          {plan.title}
        </span>
        <span className="badge">
          {t('ai.plan.progress', { done, total: plan.steps.length })}
        </span>
      </div>
      <div className="ai-plan-bar">
        <div className="ai-plan-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <ol className="ai-plan-steps">
        {plan.steps.map((step, index) => (
          <li key={step.id} className={`ai-plan-step ${step.status}`}>
            <span className="ai-plan-step-icon">
              {step.status === 'done' ? (
                <Check size={12} />
              ) : step.status === 'in_progress' ? (
                <span className="spinner" style={{ width: 10, height: 10 }} />
              ) : step.status === 'failed' ? (
                <X size={12} />
              ) : (
                <Circle size={8} />
              )}
            </span>
            <div className="ai-plan-step-body">
              <span className="ai-plan-step-title">
                <span className="ai-plan-step-num">{index + 1}.</span> {step.title}
              </span>
              {step.note && <span className="ai-plan-step-note">{step.note}</span>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

interface AssistantMessageProps {
  message: ChatMessage
  streaming: boolean
  activeAssistantId: string | null
  pendingTools: PendingToolBatch | null
  allMessages: ChatMessage[]
  projectOpen: boolean
  onApprove: (callId: string) => void
  onReject: (callId: string) => void
  onApproveAll: () => void
  onRejectAll: () => void
}

function AssistantMessage({
  message,
  streaming,
  activeAssistantId,
  pendingTools,
  allMessages,
  projectOpen,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
}: AssistantMessageProps) {
  const t = useT()
  const calls = (message.toolCalls ?? []).filter((call) => call.name !== 'update_plan')
  const isStreaming = streaming && activeAssistantId === message.id
  const showTyping = isStreaming && !message.content
  const showCursor = isStreaming && !!message.content
  const batch = pendingTools && pendingTools.messageId === message.id ? pendingTools : null
  const pendingCount = batch
    ? calls.filter((call) => (batch.decisions[call.id] ?? 'pending') === 'pending').length
    : 0
  const bulkNeedsProject = calls.some((call) => requiresProject(call.name))

  if (!message.content && !calls.length && !isStreaming) return null

  return (
    <div className="ai-msg ai-msg-assistant">
      <div className="ai-msg-meta">
        <span className="ai-msg-role">
          <Sparkles size={11} />
          {t('ai.assistant')}
        </span>
        {!!message.content && <MessageCopyButton text={message.content} />}
      </div>
      <div className="ai-assistant-card">
        {message.content && (
          <div className="ai-msg-content">
            <Markdown text={message.content} />
            {showCursor && <span className="ai-cursor" aria-hidden="true" />}
          </div>
        )}
        {showTyping && <TypingIndicator label={t('ai.typing')} />}
        {calls.length > 0 && (
          <div className="ai-tools">
            {calls.map((call) => (
              <ToolCallCard
                key={call.id}
                call={call}
                batch={batch}
                resultMessage={allMessages.find(
                  (item) => item.role === 'tool' && item.toolCallId === call.id,
                )}
                projectOpen={projectOpen}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
            {batch && pendingCount > 1 && (
              <div className="ai-tool-bulk">
                <span className="ai-tool-bulk-label">
                  {t('ai.tool.pendingCount', { count: pendingCount })}
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn small primary"
                  disabled={(bulkNeedsProject && !projectOpen) || !!batch?.executing}
                  title={bulkNeedsProject && !projectOpen ? t('ai.toolsDisabled') : t('ai.tool.approveAllHint')}
                  onClick={onApproveAll}
                >
                  {t('ai.tool.approveAll')}
                </button>
                <button
                  type="button"
                  className="btn small"
                  disabled={!!batch?.executing}
                  title={t('ai.tool.rejectAllHint')}
                  onClick={onRejectAll}
                >
                  {t('ai.tool.rejectAll')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- panel */

export function AIChatPanel() {
  const t = useT()
  const settings = useApp((state) => state.settings)
  const project = useApp((state) => state.project)
  const {
    messages,
    draft,
    streaming,
    stopping,
    activeAssistantId,
    pendingTools,
    plan,
    error,
    setDraft,
    send,
    stop,
    retry,
    clear,
    dismissError,
    approveTool,
    rejectTool,
    approveAll,
    rejectAll,
    tokenEstimate,
  } = useAiChat()

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [hasNew, setHasNew] = useState(false)

  const apiKeyMissing = !settings.ai.apiKey.trim()
  const model = settings.ai.model.trim()
  const tokenText = t('ai.tokens', {
    count: tokenEstimate.toLocaleString(
      settings.language === 'ru' ? 'ru-RU' : 'en-US',
    ),
  })
  const canSend =
    draft.trim().length > 0 && !streaming && !pendingTools && !apiKeyMissing

  const openSettings = useCallback(() => {
    useApp.getState().setDialog('settings', true)
  }, [])
  const closePanel = useCallback(() => {
    useApp.getState().setAiVisible(false)
  }, [])
  const openProject = useCallback(() => {
    void useApp.getState().projectOpenDialog()
  }, [])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 160
    const nextHeight = Math.min(Math.max(el.scrollHeight, 34), maxHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [draft])

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    setAtBottom(true)
    setHasNew(false)
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 56
    atBottomRef.current = nearBottom
    setAtBottom(nearBottom)
    if (nearBottom) setHasNew(false)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight
      setHasNew(false)
    } else {
      setHasNew(true)
    }
  }, [messages, pendingTools, streaming])

  const submit = () => {
    if (!canSend) return
    atBottomRef.current = true
    setAtBottom(true)
    setHasNew(false)
    send(draft)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const pickExample = (text: string) => {
    setDraft(text)
    window.setTimeout(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.selectionStart = el.selectionEnd = el.value.length
    }, 0)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      // Escape in the composer must never close the app / panel.
      event.stopPropagation()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      submit()
    }
  }

  const composerHint = apiKeyMissing
    ? t('ai.setup.keyMissing')
    : pendingTools
      ? t('ai.toolsPendingHint')
      : streaming
        ? t('ai.answering')
        : t('ai.composerHint')

  return (
    <div className="ai-root" aria-label={t('ai.title')}>
      <header className="ai-header">
        <div className="ai-title" title={t('ai.title')}>
          <Sparkles size={14} />
          <span>{t('ai.title')}</span>
        </div>
        <div className="ai-header-meta">
          <button
            type="button"
            className="badge accent ai-model"
            title={model ? t('ai.modelTitle', { model }) : t('ai.modelMissing')}
            onClick={openSettings}
          >
            {model || t('ai.modelNone')}
          </button>
          <span className="badge ai-tokens" title={t('ai.tokensHint')}>
            {tokenText}
          </span>
          <button
            type="button"
            className="icon-btn"
            title={t('ai.settings')}
            aria-label={t('ai.settings')}
            onClick={openSettings}
          >
            <Settings size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t('ai.clear')}
            aria-label={t('ai.clear')}
            disabled={messages.length === 0}
            onClick={clear}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t('ai.close')}
            aria-label={t('ai.close')}
            onClick={closePanel}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {!project && (
        <div className="ai-banner" role="note">
          <FolderOpen size={14} className="ai-banner-icon" />
          <div className="ai-banner-text">{t('ai.noProject')}</div>
          <button type="button" className="btn small" onClick={openProject}>
            {t('ai.openProject')}
          </button>
        </div>
      )}

      {apiKeyMissing && (
        <SetupCard baseUrl={settings.ai.baseUrl.trim()} model={model} onOpen={openSettings} />
      )}

      <PlanPanel plan={plan} />

      <div className="ai-scroll-wrap">
        <div
          ref={scrollRef}
          className="ai-messages"
          onScroll={handleScroll}
          aria-busy={streaming}
        >
          {messages.length === 0 && <EmptyState onPick={pickExample} />}
          {messages.map((message) => {
            if (message.role === 'user') {
              return <UserMessage key={message.id} message={message} />
            }
            if (message.role === 'assistant') {
              return (
                <AssistantMessage
                  key={message.id}
                  message={message}
                  streaming={streaming}
                  activeAssistantId={activeAssistantId}
                  pendingTools={pendingTools}
                  allMessages={messages}
                  projectOpen={!!project}
                  onApprove={approveTool}
                  onReject={rejectTool}
                  onApproveAll={approveAll}
                  onRejectAll={rejectAll}
                />
              )
            }
            return null
          })}
        </div>
        {!atBottom && (
          <button type="button" className="ai-scroll-btn" onClick={jumpToBottom}>
            <ArrowDown size={12} />
            {hasNew ? t('ai.newMessages') : t('ai.scrollBottom')}
          </button>
        )}
      </div>

      <div className="ai-composer">
        {error && (
          <div className="ai-error" role="alert">
            <AlertTriangle size={14} className="ai-error-icon" />
            <div className="ai-error-body">
              <div className="ai-error-title">{t('ai.error')}</div>
              <div className="ai-error-message">{friendlyApiError(t, error.message)}</div>
            </div>
            <div className="ai-error-actions">
              <button type="button" className="btn small" onClick={retry}>
                <RotateCcw size={12} />
                {t('ai.retry')}
              </button>
              <button
                type="button"
                className="icon-btn sm"
                title={t('ai.dismiss')}
                aria-label={t('ai.dismiss')}
                onClick={dismissError}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        <div className="ai-composer-box">
          <textarea
            ref={textareaRef}
            className="textarea ai-composer-input"
            rows={1}
            value={draft}
            disabled={streaming}
            placeholder={
              apiKeyMissing
                ? t('ai.placeholderNoKey')
                : pendingTools
                  ? t('ai.toolsPendingHint')
                  : t('ai.placeholder')
            }
            aria-label={t('ai.composerAria')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="ai-composer-actions">
            <span className="ai-hint" title={composerHint}>
              {composerHint}
            </span>
            {streaming ? (
              <button
                type="button"
                className="btn small danger"
                onClick={stop}
                disabled={stopping}
                title={t('ai.stop')}
              >
                <Square size={11} />
                {stopping ? t('ai.stopping') : t('ai.stop')}
              </button>
            ) : (
              <button
                type="button"
                className="btn small primary"
                onClick={submit}
                disabled={!canSend}
                title={apiKeyMissing ? t('ai.setup.keyMissing') : t('ai.send')}
              >
                <Send size={12} />
                {t('ai.send')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
