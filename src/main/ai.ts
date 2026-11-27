import type { AiChatRequest, AiExecToolRequest, AiExecToolResult, AiSettings, AiToolCall, ChatMessage, EmitFn } from '../shared/types'
import { settingsStore } from './settings'
import { WorkspaceService } from './workspace'

const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Прочитать текстовый файл проекта. Путь относительно корня проекта.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Путь к файлу относительно корня проекта' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Перезаписать содержимое существующего файла проекта целиком.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к файлу относительно корня проекта' },
          content: { type: 'string', description: 'Новое содержимое файла' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Создать новый файл проекта (папки создаются автоматически).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к файлу относительно корня проекта' },
          content: { type: 'string', description: 'Содержимое файла' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Удалить файл проекта. Требуется подтверждение пользователя.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Путь к файлу относительно корня проекта' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Показать содержимое папки проекта.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Путь к папке относительно корня проекта ("" — корень)' } },
      },
    },
  },
]

interface OpenAiMessage {
  role: string
  content?: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

function joinUrl(baseUrl: string, suffix: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('Не указан адрес API')
  if (base.endsWith(suffix)) return base
  return `${base}${suffix}`
}

export class AiService {
  private controllers = new Map<string, AbortController>()

  constructor(
    private emit: EmitFn,
    private workspace: WorkspaceService,
  ) {}

  private buildMessages(settings: AiSettings, history: ChatMessage[]): OpenAiMessage[] {
    const out: OpenAiMessage[] = []
    const system = settings.systemPrompt?.trim()
    if (system) out.push({ role: 'system', content: system })
    for (const msg of history) {
      if (msg.role === 'system') continue
      if (msg.role === 'user') {
        out.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls?.length) {
          out.push({
            role: 'assistant',
            content: msg.content || '',
            tool_calls: msg.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.arguments || '{}' },
            })),
          })
        } else {
          out.push({ role: 'assistant', content: msg.content })
        }
      } else if (msg.role === 'tool') {
        out.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        })
      }
    }
    return out
  }

  async chat(req: AiChatRequest): Promise<void> {
    const settings = settingsStore.get().ai
    const { requestId } = req
    if (!settings.baseUrl?.trim()) {
      this.emit('ai:done', { requestId, ok: false, error: 'Не указан адрес API (Настройки → ИИ)' })
      return
    }
    if (!settings.apiKey?.trim()) {
      this.emit('ai:done', { requestId, ok: false, error: 'Не указан API-ключ (Настройки → ИИ)' })
      return
    }
    if (!settings.model?.trim()) {
      this.emit('ai:done', { requestId, ok: false, error: 'Не указана модель (Настройки → ИИ)' })
      return
    }

    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    let content = ''
    let finishReason = ''
    const toolAcc: Record<number, AiToolCall> = {}

    try {
      const body: Record<string, unknown> = {
        model: settings.model.trim(),
        messages: this.buildMessages(settings, req.messages),
        stream: true,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
      }
      if (settings.toolsEnabled) {
        body.tools = TOOL_DEFS
        body.tool_choice = 'auto'
      }

      const res = await fetch(joinUrl(settings.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey.trim()}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        let detail = text
        try {
          const parsed = JSON.parse(text)
          detail = parsed.error?.message || parsed.message || text
        } catch {
          /* keep raw */
        }
        throw new Error(`API ${res.status}: ${String(detail).slice(0, 500) || res.statusText}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      let done = false
      while (!done) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIdx = buffer.indexOf('\n')
        while (newlineIdx >= 0) {
          const rawLine = buffer.slice(0, newlineIdx).trim()
          buffer = buffer.slice(newlineIdx + 1)
          newlineIdx = buffer.indexOf('\n')
          if (!rawLine || rawLine.startsWith(':')) continue
          if (!rawLine.startsWith('data:')) continue
          const data = rawLine.slice(5).trim()
          if (data === '[DONE]') {
            done = true
            break
          }
          let json: any
          try {
            json = JSON.parse(data)
          } catch {
            continue
          }
          const choice = json.choices?.[0]
          if (!choice) continue
          if (choice.finish_reason) finishReason = choice.finish_reason
          const delta = choice.delta || {}
          if (typeof delta.content === 'string' && delta.content.length) {
            content += delta.content
            this.emit('ai:chunk', { requestId, delta: delta.content })
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = typeof tc.index === 'number' ? tc.index : 0
              const acc = (toolAcc[index] ||= { id: tc.id || `call_${index}`, name: '', arguments: '' })
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name += tc.function.name
              if (tc.function?.arguments) acc.arguments += tc.function.arguments
            }
          }
        }
      }

      const calls = Object.values(toolAcc).filter((c) => c.name)
      if (calls.length) {
        this.emit('ai:tools', { requestId, calls })
        this.emit('ai:done', { requestId, ok: true, content, finishReason: finishReason || 'tool_calls' })
      } else {
        this.emit('ai:done', { requestId, ok: true, content, finishReason })
      }
    } catch (err) {
      const aborted = controller.signal.aborted
      this.emit('ai:done', {
        requestId,
        ok: false,
        error: aborted ? 'Запрос остановлен' : (err as Error).message || 'Ошибка запроса к нейросети',
      })
    } finally {
      this.controllers.delete(requestId)
    }
  }

  abort(requestId: string): void {
    this.controllers.get(requestId)?.abort()
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }

  /** Execute a tool call after the user approved it in the chat UI. */
  async execTool(req: AiExecToolRequest): Promise<AiExecToolResult> {
    if (!this.workspace.getRoot()) return { ok: false, error: 'Проект не открыт — инструменты работают только внутри проекта' }
    const name = req.name
    const args = req.args || {}
    const relPath = typeof args.path === 'string' ? args.path : ''
    try {
      switch (name) {
        case 'read_file': {
          if (!relPath) return { ok: false, error: 'Не указан путь' }
          const text = await this.workspace.readFile(relPath)
          const clipped = text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n[...файл обрезан, показаны первые 120000 символов]` : text
          return { ok: true, result: clipped }
        }
        case 'write_file': {
          if (!relPath) return { ok: false, error: 'Не указан путь' }
          if (typeof args.content !== 'string') return { ok: false, error: 'Не указано содержимое' }
          await this.workspace.writeFile(relPath, args.content)
          return { ok: true, result: `Файл ${relPath} сохранён (${args.content.length} символов)` }
        }
        case 'create_file': {
          if (!relPath) return { ok: false, error: 'Не указан путь' }
          const content = typeof args.content === 'string' ? args.content : ''
          await this.workspace.createFile(relPath, content)
          return { ok: true, result: `Файл ${relPath} создан` }
        }
        case 'delete_file': {
          if (!relPath) return { ok: false, error: 'Не указан путь' }
          await this.workspace.remove(relPath)
          return { ok: true, result: `Файл ${relPath} удалён` }
        }
        case 'list_dir': {
          const abs = relPath ? this.workspace.resolveInside(relPath) : this.workspace.resolveInside('.')
          const entries = await this.workspace.listDirs(abs)
          const text = entries.map((e) => (e.isDir ? `${e.name}/` : e.name)).join('\n') || '(пусто)'
          return { ok: true, result: text }
        }
        default:
          return { ok: false, error: `Неизвестный инструмент: ${String(name)}` }
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }
}
