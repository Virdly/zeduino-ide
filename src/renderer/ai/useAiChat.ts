import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type {
  AiChunkEvent,
  AiDoneEvent,
  AiPlan,
  AiToolCall,
  AiToolCallsEvent,
  AiToolName,
  ChatMessage,
} from '../../shared/types'

/* -------------------------------------------------------------------- types */

export type ToolDecision = 'pending' | 'running' | 'approved' | 'rejected' | 'error'

export interface ToolCallResult {
  ok: boolean
  content: string
}

export interface PendingToolBatch {
  messageId: string
  calls: AiToolCall[]
  decisions: Record<string, ToolDecision>
  results: Record<string, ToolCallResult>
  executing: boolean
}

export interface AiChatError {
  message: string
  /** Assistant message that should be dropped before retrying. */
  assistantId: string | null
}

export interface AiChatState {
  messages: ChatMessage[]
  draft: string
  streaming: boolean
  stopping: boolean
  requestId: string | null
  activeAssistantId: string | null
  pendingTools: PendingToolBatch | null
  plan: AiPlan | null
  error: AiChatError | null

  setDraft(text: string): void
  send(text: string): void
  stop(): void
  retry(): void
  clear(): void
  dismissError(): void

  approveTool(callId: string): void
  rejectTool(callId: string): void
  approveAll(): void
  rejectAll(): void
}

export const REJECTED_TOOL_CONTENT = 'Отклонено пользователем'

/* ------------------------------------------------------------- module state */

let idSeq = 0
let subscribed = false
const stopRequested = new Set<string>()

function uid(prefix: string): string {
  idSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}`
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/* ------------------------------------------------------------------- store */

export const useAiChatStore = create<AiChatState>((set, get) => ({
  messages: [],
  draft: '',
  streaming: false,
  stopping: false,
  requestId: null,
  activeAssistantId: null,
  pendingTools: null,
  plan: null,
  error: null,

  setDraft: (text) => set({ draft: text }),
  send: (text) => doSend(text),
  stop: () => doStop(),
  retry: () => doRetry(),
  clear: () => doClear(),
  dismissError: () => set({ error: null }),

  approveTool: (callId) => {
    void doApproveTool(callId)
  },
  rejectTool: (callId) => doRejectTool(callId),
  approveAll: () => {
    void doApproveAll()
  },
  rejectAll: () => doRejectAll(),
}))

/* ----------------------------------------------------------- subscriptions */

function ensureSubscribed(): void {
  if (subscribed) return
  if (typeof window === 'undefined' || !window.api?.ai) return
  subscribed = true
  window.api.ai.onChunk(handleChunk)
  window.api.ai.onTools(handleTools)
  window.api.ai.onDone(handleDone)
  window.api.ai.onPlan(handlePlan)
}

/**
 * The event subscriptions intentionally live for the whole renderer lifetime:
 * the panel unmounts when it is hidden, but an in-flight stream must still be
 * collected into the module-level store.
 */
function useSubscriptions(): void {
  useEffect(() => {
    ensureSubscribed()
  }, [])
}

// Subscribe eagerly as well: the panel can be closed mid-stream, and the
// module-level store must keep collecting chunks across that unmount.
if (typeof window !== 'undefined') ensureSubscribed()

/* ------------------------------------------------------------- request flow */

function buildApiMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => !(message.role === 'assistant' && message.pending))
    .map((message) => {
      const out: ChatMessage = {
        id: message.id,
        role: message.role,
        content: message.content,
      }
      if (message.toolCalls?.length) out.toolCalls = message.toolCalls
      if (message.toolCallId) out.toolCallId = message.toolCallId
      if (message.name) out.name = message.name
      return out
    })
}

function startRequest(history: ChatMessage[]): void {
  const requestId = uid('req')
  const assistantId = uid('assistant')
  const placeholder: ChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    pending: true,
  }
  const messages = [...history, placeholder]

  useAiChatStore.setState({
    messages,
    streaming: true,
    stopping: false,
    requestId,
    activeAssistantId: assistantId,
    pendingTools: null,
    error: null,
  })

  const apiMessages = buildApiMessages(messages)
  const api = window.api
  if (!api?.ai) {
    handleDone({ requestId, ok: false, error: 'Мост с главным процессом недоступен' })
    return
  }
  void api.ai.chat({ requestId, messages: apiMessages }).catch((err: unknown) => {
    if (useAiChatStore.getState().requestId !== requestId) return
    handleDone({ requestId, ok: false, error: errorMessage(err) })
  })
}

function doSend(text: string): void {
  const state = useAiChatStore.getState()
  const content = text.trim()
  if (!content || state.streaming || state.pendingTools) return
  const userMessage: ChatMessage = {
    id: uid('user'),
    role: 'user',
    content,
    createdAt: Date.now(),
  }
  const messages = [...state.messages, userMessage]
  useAiChatStore.setState({ messages, draft: '', error: null })
  startRequest(messages)
}

function doStop(): void {
  const state = useAiChatStore.getState()
  const requestId = state.requestId
  if (!requestId || state.stopping) return
  stopRequested.add(requestId)
  useAiChatStore.setState({ stopping: true })
  void window.api.ai.abort(requestId).catch(() => undefined)

  // Safety net in case the main process never emits ai:done after an abort.
  window.setTimeout(() => {
    const current = useAiChatStore.getState()
    if (current.requestId === requestId && current.streaming) {
      handleDone({ requestId, ok: false, error: 'Запрос остановлен' })
    }
  }, 2500)
}

function doClear(): void {
  const state = useAiChatStore.getState()
  if (state.requestId) {
    const requestId = state.requestId
    stopRequested.add(requestId)
    void window.api.ai.abort(requestId).catch(() => undefined)
  }
  useAiChatStore.setState({
    messages: [],
    pendingTools: null,
    plan: null,
    error: null,
    streaming: false,
    stopping: false,
    requestId: null,
    activeAssistantId: null,
  })
}

function doRetry(): void {
  const state = useAiChatStore.getState()
  if (!state.error || state.streaming || state.pendingTools) return
  let messages = state.messages
  if (state.error.assistantId) {
    messages = messages.filter((message) => message.id !== state.error?.assistantId)
  }
  messages = messages.filter(
    (message) =>
      !(message.role === 'assistant' && !message.content.trim() && !message.toolCalls?.length),
  )
  useAiChatStore.setState({ messages, error: null })
  if (!messages.length) return
  startRequest(messages)
}

/* ------------------------------------------------------------- stream events */

function handleChunk(event: AiChunkEvent): void {
  const state = useAiChatStore.getState()
  if (state.requestId !== event.requestId || !state.activeAssistantId || !event.delta) return
  const assistantId = state.activeAssistantId
  useAiChatStore.setState({
    messages: state.messages.map((message) =>
      message.id === assistantId ? { ...message, content: message.content + event.delta } : message,
    ),
  })
}

function normalizeCalls(calls: AiToolCall[] | undefined): AiToolCall[] {
  const list: AiToolCall[] = []
  const seen = new Set<string>()
  const input = Array.isArray(calls) ? calls : []
  for (let index = 0; index < input.length; index += 1) {
    const call = input[index]
    if (!call || typeof call.name !== 'string' || !call.name) continue
    let id =
      typeof call.id === 'string' && call.id.trim()
        ? call.id.trim()
        : `call_${index}_${Date.now().toString(36)}`
    if (seen.has(id)) id = `${id}_${index}`
    seen.add(id)
    const args = typeof call.arguments === 'string' && call.arguments.trim() ? call.arguments : '{}'
    list.push({ id, name: call.name, arguments: args })
  }
  return list
}

function handleTools(event: AiToolCallsEvent): void {
  void handleToolsAsync(event)
}

function handlePlan(plan: AiPlan | null): void {
  useAiChatStore.setState({ plan })
}

/**
 * `update_plan` only changes the visible plan, so it is applied immediately;
 * every other tool waits for an explicit user decision.
 */
async function handleToolsAsync(event: AiToolCallsEvent): Promise<void> {
  const state = useAiChatStore.getState()
  if (state.requestId !== event.requestId) return
  const messageId = state.activeAssistantId
  if (!messageId) return
  const calls = normalizeCalls(event.calls)
  if (!calls.length) return

  const autoCalls = calls.filter((call) => call.name === 'update_plan')
  const manualCalls = calls.filter((call) => call.name !== 'update_plan')
  const decisions: Record<string, ToolDecision> = {}
  for (const call of manualCalls) decisions[call.id] = 'pending'

  const baseMessages = state.messages.map((message) =>
    message.id === messageId ? { ...message, pending: false, toolCalls: calls } : message,
  )
  useAiChatStore.setState({
    streaming: false,
    stopping: false,
    messages: baseMessages,
    pendingTools: manualCalls.length
      ? { messageId, calls: manualCalls, decisions, results: {}, executing: false }
      : null,
  })

  if (!autoCalls.length) return

  const toolMessages: ChatMessage[] = []
  for (const call of autoCalls) {
    const result = await executeToolCall(call)
    toolMessages.push({
      id: uid('tool'),
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content: result.content,
      error: result.ok ? undefined : result.content,
      createdAt: Date.now(),
    })
  }

  const current = useAiChatStore.getState()
  const messages = [...current.messages, ...toolMessages]
  useAiChatStore.setState({ messages })
  if (!current.pendingTools) startRequest(messages)
}

function handleDone(event: AiDoneEvent): void {
  const state = useAiChatStore.getState()
  if (state.requestId !== event.requestId) return

  const assistantId = state.activeAssistantId
  const wasStopped = stopRequested.has(event.requestId)
  stopRequested.delete(event.requestId)

  if (event.ok) {
    const finalContent =
      typeof event.content === 'string' && event.content.length > 0 ? event.content : null
    const messages = state.messages
      .map((message) =>
        message.id === assistantId
          ? { ...message, content: finalContent ?? message.content, pending: false }
          : message,
      )
      .filter(
        (message) =>
          !(
            message.id === assistantId &&
            !message.content.trim() &&
            !message.toolCalls?.length
          ),
      )
    useAiChatStore.setState({
      messages,
      streaming: false,
      stopping: false,
      requestId: null,
      activeAssistantId: null,
      error: null,
    })
    return
  }

  const failedMessage = state.messages.find((message) => message.id === assistantId)
  const keepFailedMessage = !!failedMessage && (!!failedMessage.content.trim() || !!failedMessage.toolCalls?.length)
  const messages = state.messages
    .map((message) => (message.id === assistantId ? { ...message, pending: false } : message))
    .filter((message) => !(message.id === assistantId && !keepFailedMessage))

  useAiChatStore.setState({
    messages,
    streaming: false,
    stopping: false,
    requestId: null,
    activeAssistantId: null,
    error: wasStopped
      ? null
      : {
          message: event.error?.trim() || 'Не удалось получить ответ',
          assistantId: keepFailedMessage ? assistantId : null,
        },
  })
}

/* ---------------------------------------------------------- tool execution */

function parseToolArguments(raw: string): Record<string, unknown> {
  const text = raw?.trim() ? raw.trim() : '{}'
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(errorMessage(err))
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Ожидался JSON-объект')
  }
  return parsed as Record<string, unknown>
}

async function executeToolCall(call: AiToolCall): Promise<ToolCallResult> {
  let args: Record<string, unknown>
  try {
    args = parseToolArguments(call.arguments)
  } catch (err) {
    return {
      ok: false,
      content: `Не удалось разобрать аргументы инструмента: ${errorMessage(err)}`,
    }
  }
  try {
    const result = await window.api.ai.execTool({ name: call.name as AiToolName, args })
    if (result.ok) return { ok: true, content: result.result ?? '' }
    return { ok: false, content: result.error?.trim() || 'Инструмент завершился с ошибкой' }
  } catch (err) {
    return { ok: false, content: errorMessage(err) }
  }
}

function isResolved(decision: ToolDecision | undefined): boolean {
  return decision === 'approved' || decision === 'rejected' || decision === 'error'
}

function finalizeBatchIfReady(batch: PendingToolBatch): void {
  const state = useAiChatStore.getState()
  const current = state.pendingTools
  if (!current || current.messageId !== batch.messageId) return
  if (current.executing) return
  if (!current.calls.every((call) => isResolved(current.decisions[call.id]))) return

  const toolMessages: ChatMessage[] = current.calls.map((call) => {
    const decision = current.decisions[call.id]
    const result = current.results[call.id]
    let content = 'Инструмент не выполнен'
    let error: string | undefined

    if (decision === 'rejected') {
      content = REJECTED_TOOL_CONTENT
    } else if (result) {
      content = result.content
      if (!result.ok) error = result.content
    } else {
      error = content
    }

    return {
      id: uid('tool'),
      role: 'tool',
      toolCallId: call.id,
      name: call.name,
      content,
      error,
      createdAt: Date.now(),
    }
  })

  const messages = [...state.messages, ...toolMessages]
  useAiChatStore.setState({ messages, pendingTools: null })
  startRequest(messages)
}

async function doApproveTool(callId: string): Promise<void> {
  const state = useAiChatStore.getState()
  const batch = state.pendingTools
  if (!batch || batch.executing) return
  const call = batch.calls.find((item) => item.id === callId)
  if (!call || batch.decisions[callId] !== 'pending') return

  useAiChatStore.setState({
    pendingTools: {
      ...batch,
      executing: true,
      decisions: { ...batch.decisions, [callId]: 'running' },
    },
  })

  const result = await executeToolCall(call)

  const after = useAiChatStore.getState()
  const current = after.pendingTools
  if (!current || current.messageId !== batch.messageId) return
  const next: PendingToolBatch = {
    ...current,
    executing: false,
    decisions: {
      ...current.decisions,
      [callId]: result.ok ? 'approved' : 'error',
    },
    results: { ...current.results, [callId]: result },
  }
  useAiChatStore.setState({ pendingTools: next })
  finalizeBatchIfReady(next)
}

function doRejectTool(callId: string): void {
  const state = useAiChatStore.getState()
  const batch = state.pendingTools
  if (!batch || batch.executing) return
  if (batch.decisions[callId] !== 'pending') return
  const next: PendingToolBatch = {
    ...batch,
    decisions: { ...batch.decisions, [callId]: 'rejected' },
  }
  useAiChatStore.setState({ pendingTools: next })
  finalizeBatchIfReady(next)
}

async function doApproveAll(): Promise<void> {
  const state = useAiChatStore.getState()
  const batch = state.pendingTools
  if (!batch || batch.executing) return
  const pendingCalls = batch.calls.filter(
    (call) => (batch.decisions[call.id] ?? 'pending') === 'pending',
  )
  if (!pendingCalls.length) return

  const runningDecisions: Record<string, ToolDecision> = { ...batch.decisions }
  for (const call of pendingCalls) runningDecisions[call.id] = 'running'
  useAiChatStore.setState({
    pendingTools: { ...batch, executing: true, decisions: runningDecisions },
  })

  for (const call of pendingCalls) {
    const result = await executeToolCall(call)
    const after = useAiChatStore.getState()
    const current = after.pendingTools
    if (!current || current.messageId !== batch.messageId) return
    const decisions: Record<string, ToolDecision> = {
      ...current.decisions,
      [call.id]: result.ok ? 'approved' : 'error',
    }
    const stillRunning = pendingCalls.some((item) => decisions[item.id] === 'running')
    useAiChatStore.setState({
      pendingTools: {
        ...current,
        executing: stillRunning,
        decisions,
        results: { ...current.results, [call.id]: result },
      },
    })
  }

  const finalState = useAiChatStore.getState().pendingTools
  if (!finalState || finalState.messageId !== batch.messageId) return
  const cleared: PendingToolBatch = { ...finalState, executing: false }
  useAiChatStore.setState({ pendingTools: cleared })
  finalizeBatchIfReady(cleared)
}

function doRejectAll(): void {
  const state = useAiChatStore.getState()
  const batch = state.pendingTools
  if (!batch || batch.executing) return
  const decisions: Record<string, ToolDecision> = { ...batch.decisions }
  for (const call of batch.calls) {
    if (decisions[call.id] === 'pending') decisions[call.id] = 'rejected'
  }
  const next: PendingToolBatch = { ...batch, decisions }
  useAiChatStore.setState({ pendingTools: next })
  finalizeBatchIfReady(next)
}

/* ---------------------------------------------------------------- utilities */

/** Rough token estimate (4 characters per token) used for the header chip. */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0
  for (const message of messages) {
    chars += message.content?.length ?? 0
    if (message.toolCalls) {
      for (const call of message.toolCalls) {
        chars += (call.name?.length ?? 0) + (call.arguments?.length ?? 0)
      }
    }
  }
  return Math.ceil(chars / 4)
}

/* -------------------------------------------------------------------- hook */

export function useAiChat() {
  useSubscriptions()
  const state = useAiChatStore()
  const tokenEstimate = useMemo(() => estimateTokens(state.messages), [state.messages])
  return {
    ...state,
    busy: state.streaming || state.pendingTools !== null,
    tokenEstimate,
  }
}
