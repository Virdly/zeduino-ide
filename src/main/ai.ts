import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type {
  AiChatRequest,
  AiExecToolRequest,
  AiExecToolResult,
  AiPlan,
  AiPlanStep,
  AiSettings,
  AiToolCall,
  ChatMessage,
  EmitFn,
} from '../shared/types'
import { settingsStore } from './settings'
import { WorkspaceService } from './workspace'

/* ------------------------------------------------------------------ helpers */

const MAX_READ_CHARS = 120_000
const MAX_OUTPUT_CHARS = 40_000
const MAX_FETCH_BYTES = 2_000_000
const MAX_FETCH_TEXT = 30_000
const MAX_TREE_ENTRIES = 600
const DEFAULT_TIMEOUT = 60_000
const MAX_TIMEOUT = 180_000

const IGNORED_DIRS = new Set(['node_modules', '.git', '.zeduino', 'dist', 'release', 'artifacts'])

function isInside(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root).toLowerCase().replace(/[\\/]+$/, '')
  const normalizedTarget = path.resolve(target).toLowerCase()
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

function looksAbsolute(input: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(input) || input.startsWith('\\\\') || input.startsWith('/')
}

function clip(text: string, limit = MAX_OUTPUT_CHARS): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n[...обрезано, всего ${text.length} символов]`
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

interface ProcessResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Spawns a process, captures output and kills the whole tree on timeout. */
function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        windowsHide: true,
      })
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: errorMessage(err), timedOut: false })
      return
    }

    let stdout = ''
    let stderr = ''
    let finished = false
    const timeoutMs = Math.max(1_000, Math.min(MAX_TIMEOUT, options.timeoutMs ?? DEFAULT_TIMEOUT))

    const finish = (code: number, timedOut: boolean) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }

    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        /* ignore */
      }
      finish(-1, true)
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => finish(-1, false))
    child.on('close', (code) => finish(code ?? 0, false))
  })
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
    laquo: '«',
    raquo: '»',
    hellip: '…',
  }
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) || 32))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10) || 32))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
}

function htmlToText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(cleaned)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeArgsList(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((value) => String(value))
  if (typeof input === 'string' && input.trim()) {
    return input.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) ?? []
  }
  return []
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  return false
}

/* ---------------------------------------------------------------- tool defs */

const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Прочитать текстовый файл. Путь относительный (в проекте) или абсолютный — внутри папки проекта или папки библиотек.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Путь к файлу' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Точечно изменить существующий файл: заменить точный фрагмент old_text на new_text, не переписывая файл целиком. ' +
        'Если old_text встречается несколько раз, укажите replace_all=true или более длинный контекст.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к файлу' },
          old_text: { type: 'string', description: 'Точный фрагмент, который нужно заменить (включая отступы)' },
          new_text: { type: 'string', description: 'Новый текст (пустая строка = удалить фрагмент)' },
          replace_all: { type: 'boolean', description: 'Заменить все вхождения (по умолчанию false)' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Полностью перезаписать существующий файл. Для небольших правок используйте edit_file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к файлу' },
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
      description: 'Создать новый файл (папки создаются автоматически).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к файлу' },
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
      description: 'Удалить файл или папку. Требуется подтверждение пользователя.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Путь к файлу или папке' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description:
        'Показать содержимое папки. С recursive=true возвращает дерево подпапок и файлов (до 600 записей) — ' +
        'это самый быстрый способ увидеть структуру проекта.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к папке ("" — корень проекта)' },
          recursive: { type: 'boolean', description: 'Рекурсивно (по умолчанию false)' },
          depth: { type: 'number', description: 'Глубина рекурсии, 1–4 (по умолчанию 3)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_libraries',
      description:
        'Список установленных библиотек Arduino: имя, версия, абсолютный путь. Используйте его, чтобы прочитать ' +
        'исходники библиотеки и рассказать, как с ней работать. Изменение файлов библиотеки — только с подтверждением.',
      parameters: {
        type: 'object',
        properties: { filter: { type: 'string', description: 'Необязательный фильтр по имени' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_python',
      description:
        'Запустить Python-скрипт (файл или код) и получить stdout/stderr. Выполняется ТОЛЬКО после разрешения пользователя.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Путь к .py файлу (альтернатива code)' },
          code: { type: 'string', description: 'Код Python для запуска (альтернатива path)' },
          args: { type: 'string', description: 'Аргументы командной строки через пробел (необязательно)' },
          cwd: { type: 'string', description: 'Рабочая папка (по умолчанию корень проекта)' },
          timeout_ms: { type: 'number', description: 'Тайм-аут в мс (по умолчанию 60000, максимум 180000)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description:
        'Выполнить команду PowerShell или cmd.exe и получить вывод. Выполняется ТОЛЬКО после разрешения пользователя.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Команда для выполнения' },
          shell: { type: 'string', enum: ['powershell', 'cmd'], description: 'Оболочка (по умолчанию powershell)' },
          cwd: { type: 'string', description: 'Рабочая папка (по умолчанию корень проекта)' },
          timeout_ms: { type: 'number', description: 'Тайм-аут в мс (по умолчанию 60000, максимум 180000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Поиск в интернете (DuckDuckGo) — свежая информация, документация, примеры.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос' },
          max_results: { type: 'number', description: 'Сколько результатов вернуть (1–10, по умолчанию 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Загрузить веб-страницу и вернуть её текст (без HTML-разметки).',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'http(s) URL' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_plan',
      description:
        'Создать или обновить план задачи. Вызывайте в начале многошаговой задачи, затем обновляйте статусы шагов ' +
        '(pending / in_progress / done / failed) по мере выполнения.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Название плана' },
          steps: {
            type: 'array',
            description: 'Шаги плана',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Шаг' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'failed'] },
                note: { type: 'string', description: 'Короткая заметка о результате' },
              },
              required: ['title'],
            },
          },
        },
        required: ['steps'],
      },
    },
  },
]

const SYSTEM_GUIDE = `Внутренние правила этой IDE (важнее общих указаний пользователя, если они противоречат):
- Для задач из двух и более шагов сначала вызови update_plan (план), затем выполняй шаги и обновляй статусы.
- Изменяй файлы точечно через edit_file; write_file — только если нужно переписать файл целиком.
- list_dir с recursive=true — быстрый способ увидеть структуру; используй его вместо чтения каждого файла.
- Библиотеки Arduino доступны через list_libraries: получай абсолютные пути и читай файлы библиотек, чтобы объяснить использование. Изменять их можно только с подтверждением пользователя.
- run_python и run_shell — только после разрешения пользователя и только когда это действительно нужно.
- web_search — для свежей информации, web_fetch — для полного текста страницы.
- Не выходи за папку проекта и папки библиотек; не удаляй данные без необходимости.
- Отвечай по-русски, если пользователь пишет по-русски.`

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

type PathArea = 'project' | 'library'

interface ResolvedPath {
  absolute: string
  area: PathArea
  display: string
}

/* ------------------------------------------------------------------ service */

export class AiService {
  private controllers = new Map<string, AbortController>()
  private currentPlan: AiPlan | null = null
  private pythonCommand: { command: string; prefix: string[] } | null | undefined = undefined

  constructor(
    private emit: EmitFn,
    private workspace: WorkspaceService,
    private libraryRoots: () => string[] = () => [],
    private userDataDir: string = '',
  ) {}

  private get projectRoot(): string | null {
    return this.workspace.getRoot()
  }

  /** All directories tools are allowed to touch: project root + library folders. */
  private allowedRoots(): { path: string; area: PathArea }[] {
    const roots: { path: string; area: PathArea }[] = []
    const project = this.projectRoot
    if (project) roots.push({ path: project, area: 'project' })
    for (const raw of this.libraryRoots()) {
      if (!raw) continue
      const resolved = path.resolve(raw)
      if (roots.some((root) => root.area === 'library' && root.path.toLowerCase() === resolved.toLowerCase())) continue
      roots.push({ path: resolved, area: 'library' })
    }
    return roots
  }

  private resolvePath(input: string): ResolvedPath {
    const trimmed = input.trim().replace(/^["']|["']$/g, '')
    if (!trimmed) throw new Error('Не указан путь')
    const roots = this.allowedRoots()
    if (!roots.length) throw new Error('Проект не открыт — некуда разрешать пути')

    if (looksAbsolute(trimmed)) {
      const absolute = path.resolve(trimmed)
      for (const root of roots) {
        if (isInside(root.path, absolute)) {
          return { absolute, area: root.area, display: absolute }
        }
      }
      throw new Error('Путь вне папки проекта и папок библиотек')
    }

    const project = this.projectRoot
    if (!project) throw new Error('Проект не открыт — используйте абсолютный путь к библиотеке')
    const absolute = path.resolve(project, trimmed)
    if (!isInside(project, absolute)) throw new Error('Путь вне папки проекта')
    return { absolute, area: 'project', display: trimmed }
  }

  private async ensureDir(dir: string): Promise<void> {
    await fsp.mkdir(dir, { recursive: true })
  }

  private async writePrivateFile(absolute: string, content: string): Promise<void> {
    await this.ensureDir(path.dirname(absolute))
    await fsp.writeFile(absolute, content, 'utf8')
  }

  private async readTextFile(absolute: string): Promise<string> {
    const stat = await fsp.stat(absolute)
    if (!stat.isFile()) throw new Error('Это не файл')
    if (stat.size > 4 * 1024 * 1024) throw new Error('Файл слишком большой (>4 МБ)')
    const buffer = await fsp.readFile(absolute)
    if (buffer.includes(0)) throw new Error('Похоже, это бинарный файл — чтение недоступно')
    return buffer.toString('utf8')
  }

  private async tree(dir: string, recursive: boolean, depth: number): Promise<string> {
    const lines: string[] = []
    let count = 0
    const walk = async (current: string, level: number, prefix: string): Promise<void> => {
      if (count >= MAX_TREE_ENTRIES) return
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(current, { withFileTypes: true })
      } catch {
        return
      }
      entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
      for (const entry of entries) {
        if (count >= MAX_TREE_ENTRIES) break
        if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
        count += 1
        const suffix = entry.isDirectory() ? '/' : ''
        lines.push(`${prefix}${entry.name}${suffix}`)
        if (entry.isDirectory() && recursive && level < depth) {
          await walk(path.join(current, entry.name), level + 1, `${prefix}  `)
        }
      }
    }
    await walk(dir, 1, '')
    if (!lines.length) return '(пусто)'
    if (count >= MAX_TREE_ENTRIES) lines.push('[...список обрезан]')
    return lines.join('\n')
  }

  /** Replace old_text with new_text; exact match first, then whitespace-tolerant. */
  private replaceFragment(source: string, oldText: string, newText: string, replaceAll: boolean): { text: string; count: number; fuzzy: boolean } {
    const exactCount = source.split(oldText).length - 1
    if (exactCount > 0) {
      if (exactCount > 1 && !replaceAll) {
        throw new Error(`Фрагмент встречается ${exactCount} раза — добавьте больше контекста или укажите replace_all=true`)
      }
      const text = replaceAll ? source.split(oldText).join(newText) : source.replace(oldText, () => newText)
      return { text, count: replaceAll ? exactCount : 1, fuzzy: false }
    }

    // Whitespace-tolerant fallback: useful when the model reproduces indentation slightly wrong.
    const pattern = oldText
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+')
    if (pattern) {
      const re = new RegExp(pattern, replaceAll ? 'g' : '')
      const matches = source.match(re)
      if (matches && matches.length > 0) {
        if (matches.length > 1 && !replaceAll) {
          throw new Error(`Фрагмент встречается ${matches.length} раза — добавьте больше контекста или укажите replace_all=true`)
        }
        return { text: replaceAll ? source.replace(re, () => newText) : source.replace(re, () => newText), count: replaceAll ? matches.length : 1, fuzzy: true }
      }
    }
    throw new Error('Фрагмент old_text не найден. Сначала прочитайте файл через read_file и скопируйте текст точно')
  }

  private async resolvePython(): Promise<{ command: string; prefix: string[] }> {
    if (this.pythonCommand !== undefined) {
      if (!this.pythonCommand) throw new Error('Python не найден (нет python/py в PATH)')
      return this.pythonCommand
    }
    for (const [command, prefix] of [
      ['python', []],
      ['py', ['-3']],
    ] as [string, string[]][]) {
      const result = await runProcess(command, [...prefix, '--version'], { timeoutMs: 5_000 })
      if (result.code === 0) {
        this.pythonCommand = { command, prefix }
        return this.pythonCommand
      }
    }
    this.pythonCommand = null
    throw new Error('Python не найден (нет python/py в PATH)')
  }

  private async runPython(args: Record<string, unknown>): Promise<AiExecToolResult> {
    const project = this.projectRoot
    if (!project) return { ok: false, error: 'Откройте проект — Python-скрипты запускаются в папке проекта' }
    const code = typeof args.code === 'string' ? args.code : ''
    const scriptArg = typeof args.path === 'string' ? args.path.trim() : ''
    if (!code && !scriptArg) return { ok: false, error: 'Укажите path или code' }

    const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? this.resolvePath(args.cwd).absolute : project
    const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : DEFAULT_TIMEOUT
    const python = await this.resolvePython()
    let scriptPath: string
    let cleanup: string | null = null

    if (scriptArg) {
      const resolved = this.resolvePath(scriptArg)
      if (!fs.existsSync(resolved.absolute)) return { ok: false, error: `Файл скрипта не найден: ${resolved.display}` }
      scriptPath = resolved.absolute
    } else {
      const dir = path.join(this.userDataDir || project, 'ai-tmp')
      await this.ensureDir(dir)
      scriptPath = path.join(dir, `ai_script_${crypto.randomUUID()}.py`)
      await fsp.writeFile(scriptPath, code, 'utf8')
      cleanup = scriptPath
    }

    try {
      const extraArgs = normalizeArgsList(args.args)
      const result = await runProcess(python.command, [...python.prefix, scriptPath, ...extraArgs], { cwd, timeoutMs })
      const parts: string[] = []
      if (result.timedOut) parts.push(`[тайм-аут ${Math.round(timeoutMs / 1000)} с, процесс остановлен]`)
      parts.push(`exit code: ${result.code}`)
      if (result.stdout.trim()) parts.push(`--- stdout ---\n${result.stdout.trimEnd()}`)
      if (result.stderr.trim()) parts.push(`--- stderr ---\n${result.stderr.trimEnd()}`)
      if (!result.stdout.trim() && !result.stderr.trim()) parts.push('(пустой вывод)')
      return { ok: result.code === 0 && !result.timedOut, result: clip(parts.join('\n')), error: result.code !== 0 ? clip(parts.join('\n')) : undefined }
    } finally {
      if (cleanup) await fsp.rm(cleanup, { force: true }).catch(() => undefined)
    }
  }

  private async runShell(args: Record<string, unknown>): Promise<AiExecToolResult> {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    if (!command) return { ok: false, error: 'Укажите command' }
    const project = this.projectRoot
    if (!project) return { ok: false, error: 'Откройте проект — команды выполняются в папке проекта' }
    const shell = args.shell === 'cmd' ? 'cmd' : 'powershell'
    const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? this.resolvePath(args.cwd).absolute : project
    const timeoutMs = typeof args.timeout_ms === 'number' ? args.timeout_ms : DEFAULT_TIMEOUT
    const argv =
      shell === 'cmd'
        ? ['cmd.exe', '/d', '/s', '/c', command]
        : ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]

    const result = await runProcess(argv[0], argv.slice(1), { cwd, timeoutMs })
    const parts: string[] = []
    if (result.timedOut) parts.push(`[тайм-аут ${Math.round(timeoutMs / 1000)} с, процесс остановлен]`)
    parts.push(`exit code: ${result.code}`)
    if (result.stdout.trim()) parts.push(`--- stdout ---\n${result.stdout.trimEnd()}`)
    if (result.stderr.trim()) parts.push(`--- stderr ---\n${result.stderr.trimEnd()}`)
    if (!result.stdout.trim() && !result.stderr.trim()) parts.push('(пустой вывод)')
    const text = clip(parts.join('\n'))
    return result.code === 0 && !result.timedOut ? { ok: true, result: text } : { ok: false, error: text }
  }

  private formatSearchResults(results: { title: string; url: string; snippet: string }[]): string {
    return results
      .map((item, index) => `${index + 1}. ${item.title}\n   ${item.url}\n   ${clip(item.snippet, 400)}`)
      .join('\n\n')
  }

  private async webSearch(query: string, maxResults: number): Promise<string> {
    const limit = Math.max(1, Math.min(10, Math.floor(maxResults) || 5))
    const aiSettings = settingsStore.get().ai
    const provider = aiSettings.searchProvider || 'duckduckgo'
    const key = aiSettings.searchApiKey?.trim()
    const failures: string[] = []

    if (provider === 'brave' && key) {
      try {
        const url =
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}` +
          `&count=${limit}&search_lang=ru&safesearch=moderate`
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': key,
            'User-Agent': 'ZedArduino-IDE',
          },
          signal: AbortSignal.timeout(20_000),
        })
        if (!res.ok) throw new Error(`Brave HTTP ${res.status}`)
        const json: any = await res.json()
        const results = (json?.web?.results ?? []).slice(0, limit).map((item: any) => ({
          title: String(item.title ?? ''),
          url: String(item.url ?? ''),
          snippet: String(item.description ?? ''),
        }))
        if (results.length) return this.formatSearchResults(results)
        failures.push('Brave: пустой результат')
      } catch (err) {
        failures.push(`Brave: ${errorMessage(err)}`)
      }
    }

    if (provider === 'tavily' && key) {
      try {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: key,
            query,
            max_results: limit,
            search_depth: 'basic',
            include_answer: false,
          }),
          signal: AbortSignal.timeout(25_000),
        })
        if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`)
        const json: any = await res.json()
        const results = (json?.results ?? []).slice(0, limit).map((item: any) => ({
          title: String(item.title ?? ''),
          url: String(item.url ?? ''),
          snippet: String(item.content ?? ''),
        }))
        if (results.length) return this.formatSearchResults(results)
        failures.push('Tavily: пустой результат')
      } catch (err) {
        failures.push(`Tavily: ${errorMessage(err)}`)
      }
    }

    // No key / provider failed: try DuckDuckGo HTML (no key, may be rate-limited).
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'ru,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml',
    }

    const parseLite = (html: string) => {
      const results: { title: string; url: string; snippet: string }[] = []
      const linkRe = /<a[^>]+class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi
      const snippetRe = /<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi
      const snippets = [...html.matchAll(snippetRe)].map((match) => htmlToText(match[1]))
      let match: RegExpExecArray | null
      let index = 0
      while ((match = linkRe.exec(html)) && results.length < limit) {
        let url = decodeEntities(match[1])
        const redirect = url.match(/uddg=([^&]+)/)
        if (redirect) url = decodeURIComponent(redirect[1])
        results.push({
          title: htmlToText(match[2]),
          url,
          snippet: snippets[index] ?? '',
        })
        index += 1
      }
      return results
    }

    const parseHtml = (html: string) => {
      const results: { title: string; url: string; snippet: string }[] = []
      const re =
        /<a[^>]+class=['"]result__a['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class=['"]result__snippet['"][^>]*>([\s\S]*?)<\/a>|<div[^>]+class=['"]result__snippet['"][^>]*>([\s\S]*?)<\/div>)?/gi
      let match: RegExpExecArray | null
      while ((match = re.exec(html)) && results.length < limit) {
        let url = decodeEntities(match[1])
        const redirect = url.match(/uddg=([^&]+)/)
        if (redirect) url = decodeURIComponent(redirect[1])
        results.push({
          title: htmlToText(match[2]),
          url,
          snippet: htmlToText(match[3] ?? match[4] ?? ''),
        })
      }
      return results
    }

    const attempts: { url: string; parse: (html: string) => { title: string; url: string; snippet: string }[] }[] = [
      { url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, parse: parseLite },
      { url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, parse: parseHtml },
    ]

    let best: { title: string; url: string; snippet: string }[] = []
    let bestScore = -1
    for (const attempt of attempts) {
      try {
        const res = await fetch(attempt.url, { headers, signal: AbortSignal.timeout(20_000) })
        if (!res.ok) {
          failures.push(`DuckDuckGo HTTP ${res.status}`)
          continue
        }
        const html = await res.text()
        const results = attempt.parse(html).slice(0, limit)
        if (!results.length) {
          failures.push('DuckDuckGo: ничего не найдено')
          continue
        }
        const score = results.filter((item) => item.snippet.trim().length > 0).length
        if (score > bestScore) {
          best = results
          bestScore = score
        }
        if (score === results.length) break
      } catch (err) {
        failures.push(`DuckDuckGo: ${errorMessage(err)}`)
      }
    }

    if (best.length) return this.formatSearchResults(best)

    const hint = key
      ? ''
      : ' Укажите ключ Brave или Tavily в Настройках → ИИ — DuckDuckGo без ключа часто ограничивает запросы.'
    throw new Error(`Веб-поиск недоступен: ${failures.join('; ') || 'нет ответа'}.${hint}`)
  }

  private async webFetch(url: string): Promise<string> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Некорректный URL')
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('Разрешены только http(s) URL')
    if (isPrivateHost(parsed.hostname)) throw new Error('Локальные и приватные адреса запрещены')

    const res = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'ru,en;q=0.8',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const type = (res.headers.get('content-type') || '').toLowerCase()
    if (!/text\/|application\/(json|xml|xhtml)/.test(type)) throw new Error(`Неподдерживаемый тип содержимого: ${type || 'unknown'}`)

    const reader = res.body?.getReader()
    if (!reader) throw new Error('Пустой ответ')
    const decoder = new TextDecoder('utf-8')
    let raw = ''
    let received = 0
    while (received < MAX_FETCH_BYTES) {
      const { value, done } = await reader.read()
      if (done) break
      received += value.byteLength
      raw += decoder.decode(value, { stream: true })
    }
    const text = /html|xml/.test(type) ? htmlToText(raw) : raw.trim()
    return clip(text, MAX_FETCH_TEXT)
  }

  private async listLibraries(filter: string): Promise<string> {
    const roots = this.libraryRoots()
    if (!roots.length) return 'Папки библиотек не найдены.'
    const lines: string[] = []
    const needle = filter.trim().toLowerCase()
    const seen = new Set<string>()

    const addLibrary = async (dir: string): Promise<void> => {
      const key = dir.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      const propsPath = path.join(dir, 'library.properties')
      let name = path.basename(dir)
      let version = ''
      let author = ''
      let sentence = ''
      try {
        const text = await fsp.readFile(propsPath, 'utf8')
        for (const raw of text.split(/\r?\n/)) {
          const index = raw.indexOf('=')
          if (index <= 0) continue
          const keyName = raw.slice(0, index).trim().toLowerCase()
          const value = raw.slice(index + 1).trim()
          if (keyName === 'name') name = value || name
          else if (keyName === 'version') version = value
          else if (keyName === 'author') author = value
          else if (keyName === 'sentence') sentence = value
        }
      } catch {
        /* no properties */
      }
      if (needle && !`${name} ${dir}`.toLowerCase().includes(needle)) return
      lines.push(`${name}${version ? ` (v${version})` : ''}${author ? ` — ${author}` : ''}\n  ${dir}${sentence ? `\n  ${sentence}` : ''}`)
    }

    for (const root of roots) {
      if (!fs.existsSync(root)) continue
      if (fs.existsSync(path.join(root, 'library.properties'))) {
        await addLibrary(root)
        continue
      }
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        await addLibrary(path.join(root, entry.name))
        if (lines.length >= 200) break
      }
    }
    if (!lines.length) return 'Библиотеки не найдены.'
    return clip(`Найдено библиотек: ${lines.length}\n\n${lines.join('\n\n')}`, 60_000)
  }

  private async updatePlan(args: Record<string, unknown>): Promise<AiExecToolResult> {
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'План'
    const rawSteps = Array.isArray(args.steps) ? args.steps : []
    if (!rawSteps.length) return { ok: false, error: 'План должен содержать хотя бы один шаг' }
    const steps: AiPlanStep[] = []
    rawSteps.slice(0, 50).forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') return
      const item = raw as Record<string, unknown>
      const stepTitle = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Шаг ${index + 1}`
      const status =
        item.status === 'done' || item.status === 'in_progress' || item.status === 'failed' || item.status === 'pending'
          ? item.status
          : 'pending'
      steps.push({
        id: `step_${index + 1}`,
        title: stepTitle,
        status,
        note: typeof item.note === 'string' && item.note.trim() ? item.note.trim() : undefined,
      })
    })
    if (!steps.length) return { ok: false, error: 'Не удалось разобрать шаги плана' }

    const plan: AiPlan = { title, steps, updatedAt: Date.now() }
    this.currentPlan = plan
    this.emit('ai:plan', plan)
    const text = steps
      .map((step, index) => {
        const mark =
          step.status === 'done' ? 'x' : step.status === 'in_progress' ? '>' : step.status === 'failed' ? '!' : ' '
        return `${index + 1}. [${mark}] ${step.title}${step.note ? ` — ${step.note}` : ''}`
      })
      .join('\n')
    return { ok: true, result: `План «${title}» обновлён:\n${text}` }
  }

  private buildMessages(settings: AiSettings, history: ChatMessage[]): OpenAiMessage[] {
    const out: OpenAiMessage[] = []
    const system = settings.systemPrompt?.trim()
    if (system) out.push({ role: 'system', content: system })
    out.push({ role: 'system', content: SYSTEM_GUIDE })
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
        error: aborted ? 'Запрос остановлен' : errorMessage(err) || 'Ошибка запроса к нейросети',
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
    const name = req.name
    const args = req.args || {}
    try {
      switch (name) {
        case 'read_file': {
          const target = this.resolvePath(String(args.path ?? ''))
          const text = await this.readTextFile(target.absolute)
          const prefix = target.area === 'library' ? `[библиотека] ${target.absolute}\n\n` : ''
          return { ok: true, result: prefix + clip(text, MAX_READ_CHARS) }
        }
        case 'edit_file': {
          const target = this.resolvePath(String(args.path ?? ''))
          const oldText = typeof args.old_text === 'string' ? args.old_text : ''
          const newText = typeof args.new_text === 'string' ? args.new_text : ''
          if (!oldText) return { ok: false, error: 'Укажите old_text' }
          const source = await this.readTextFile(target.absolute)
          const result = this.replaceFragment(source, oldText, newText, args.replace_all === true)
          await this.writePrivateFile(target.absolute, result.text)
          const place = target.area === 'library' ? ' (библиотека)' : ''
          return {
            ok: true,
            result: `Файл ${target.display} изменён${place}: заменено вхождений ${result.count}${result.fuzzy ? ', совпадение по пробелам' : ''}. Было ${source.length} символов, стало ${result.text.length}.`,
          }
        }
        case 'write_file': {
          const target = this.resolvePath(String(args.path ?? ''))
          if (typeof args.content !== 'string') return { ok: false, error: 'Не указано содержимое' }
          await this.writePrivateFile(target.absolute, args.content)
          return {
            ok: true,
            result: `Файл ${target.display} сохранён${target.area === 'library' ? ' (библиотека)' : ''} (${args.content.length} символов)`,
          }
        }
        case 'create_file': {
          const target = this.resolvePath(String(args.path ?? ''))
          if (fs.existsSync(target.absolute)) return { ok: false, error: 'Файл уже существует — используйте write_file или edit_file' }
          const content = typeof args.content === 'string' ? args.content : ''
          await this.writePrivateFile(target.absolute, content)
          return { ok: true, result: `Файл ${target.display} создан` }
        }
        case 'delete_file': {
          const target = this.resolvePath(String(args.path ?? ''))
          const stat = await fsp.stat(target.absolute).catch(() => null)
          if (!stat) return { ok: false, error: 'Файл не найден' }
          for (const root of this.allowedRoots()) {
            if (path.resolve(target.absolute).toLowerCase() === path.resolve(root.path).toLowerCase()) {
              return { ok: false, error: 'Нельзя удалить корневую папку' }
            }
          }
          await fsp.rm(target.absolute, { recursive: true, force: true })
          return { ok: true, result: `Удалено: ${target.display}` }
        }
        case 'list_dir': {
          const input = typeof args.path === 'string' ? args.path.trim() : ''
          const target = input ? this.resolvePath(input) : this.resolvePath('.')
          const recursive = args.recursive === true
          const depth = typeof args.depth === 'number' ? Math.max(1, Math.min(4, Math.floor(args.depth))) : 3
          const text = await this.tree(target.absolute, recursive, depth)
          return { ok: true, result: `${target.display || '.'}:\n${text}` }
        }
        case 'list_libraries': {
          return { ok: true, result: await this.listLibraries(typeof args.filter === 'string' ? args.filter : '') }
        }
        case 'run_python': {
          return await this.runPython(args)
        }
        case 'run_shell': {
          return await this.runShell(args)
        }
        case 'web_search': {
          const query = typeof args.query === 'string' ? args.query.trim() : ''
          if (!query) return { ok: false, error: 'Укажите query' }
          const max = typeof args.max_results === 'number' ? args.max_results : 5
          return { ok: true, result: await this.webSearch(query, max) }
        }
        case 'web_fetch': {
          const url = typeof args.url === 'string' ? args.url.trim() : ''
          if (!url) return { ok: false, error: 'Укажите url' }
          return { ok: true, result: await this.webFetch(url) }
        }
        case 'update_plan': {
          return await this.updatePlan(args)
        }
        default:
          return { ok: false, error: `Неизвестный инструмент: ${String(name)}` }
      }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  }
}

function message(err: unknown): string {
  return errorMessage(err)
}
