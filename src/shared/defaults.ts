import type { AppSettings } from './types'

export const DEFAULT_FONT_FAMILY = "'JetBrains Mono', 'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace"

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'ru',
  theme: {
    mode: 'dark',
    accent: '#4c9aff',
    colors: {},
    uiScale: 1,
  },
  editor: {
    fontSize: 14,
    fontFamily: DEFAULT_FONT_FAMILY,
    tabSize: 2,
    wordWrap: false,
    lineNumbers: true,
    autocomplete: true,
    autoSave: true,
    autoSaveDelay: 900,
    highlightActiveLine: true,
    bracketMatching: true,
  },
  arduino: {
    cliPath: '',
    cliVersion: '',
    additionalUrls: [],
    libraryDirs: [],
    sketchbookDir: '',
    fqbn: '',
    boardOptions: {},
    baud: 9600,
    monitorLineEnding: 'lf',
    compileVerbose: false,
    autoInstallCore: true,
    port: '',
  },
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    systemPrompt:
      'Ты — ассистент внутри IDE для Arduino. Отвечай кратко и по делу, давай готовый код с комментариями. ' +
      'Для работы с файлами проекта используй инструменты: read_file, write_file, create_file, delete_file, list_dir. ' +
      'Все пути указывай относительно корня проекта. Не выходи за пределы проекта. ' +
      'Перед удалением или перезаписью файла объясни, что и зачем меняешь.',
    temperature: 0.3,
    toolsEnabled: true,
    maxTokens: 4096,
    searchProvider: 'duckduckgo',
    searchApiKey: '',
  },
  recentProjects: [],
  lastProject: null,
}
