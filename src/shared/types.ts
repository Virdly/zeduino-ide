/** Shared types between the Electron main process, preload bridge and renderer. */

export type Lang = 'ru' | 'en'

/* ------------------------------------------------------------------ settings */

export interface ThemeColors {
  bg: string
  bgElevated: string
  bgPanel: string
  bgHover: string
  bgActive: string
  border: string
  text: string
  textMuted: string
  accent: string
  accentText: string
  selection: string
  error: string
  warning: string
  success: string
  info: string
  editorBg: string
  editorText: string
  editorGutter: string
  editorCursor: string
  editorSelection: string
}

export interface ThemeSettings {
  mode: 'dark' | 'light' | 'custom'
  accent: string
  colors: Partial<ThemeColors>
  uiScale: number
}

export interface EditorSettings {
  fontSize: number
  fontFamily: string
  tabSize: number
  wordWrap: boolean
  lineNumbers: boolean
  autocomplete: boolean
  autoSave: boolean
  autoSaveDelay: number
  highlightActiveLine: boolean
  bracketMatching: boolean
}

export interface ArduinoSettings {
  cliPath: string
  cliVersion: string
  additionalUrls: string[]
  libraryDirs: string[]
  sketchbookDir: string
  fqbn: string
  boardOptions: Record<string, string>
  baud: number
  monitorLineEnding: 'none' | 'lf' | 'crlf'
  compileVerbose: boolean
  autoInstallCore: boolean
  port: string
}

export interface AiSettings {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  temperature: number
  toolsEnabled: boolean
  maxTokens: number
  /** Web search provider for the `web_search` tool. */
  searchProvider: 'duckduckgo' | 'brave' | 'tavily'
  /** API key for Brave Search or Tavily (optional; DuckDuckGo needs no key). */
  searchApiKey: string
}

export interface AppSettings {
  language: Lang
  theme: ThemeSettings
  editor: EditorSettings
  arduino: ArduinoSettings
  ai: AiSettings
  recentProjects: string[]
  lastProject: string | null
}

/* ---------------------------------------------------------------- workspace */

export interface FileNode {
  name: string
  path: string // relative to the project root, posix separators
  type: 'file' | 'dir'
  children?: FileNode[]
  ext?: string
}

export interface ProjectInfo {
  root: string
  name: string
  isSketch: boolean
  sketchName?: string
}

/* ------------------------------------------------------------------ arduino */

export interface CliStatus {
  installed: boolean
  version?: string
  path?: string
  userDir?: string
  dataDir?: string
  downloading?: boolean
  error?: string
}

export interface ConnectedBoard {
  port: string
  protocol?: string
  fqbn?: string
  boardName?: string
  core?: string
}

export interface BoardEntry {
  name: string
  fqbn: string
  platform?: string
}

export interface BoardOptionValue {
  value: string
  label: string
  selected?: boolean
}

export interface BoardOption {
  id: string
  label: string
  values: BoardOptionValue[]
}

export interface BoardDetails {
  fqbn: string
  name: string
  options: BoardOption[]
  defaultFqbn?: string
}

export interface CoreInfo {
  id: string
  name?: string
  installedVersion?: string
  latestVersion?: string
  platforms?: { architecture: string; version: string }[]
}

export interface LibraryInfo {
  name: string
  installedVersion?: string
  availableVersion?: string
  author?: string
  sentence?: string
  paragraph?: string
  website?: string
  location?: string
  type?: string
  sourcePath?: string
  headers?: string[]
}

export interface CompileRequest {
  sketchDir: string
  fqbn: string
  boardOptions?: Record<string, string>
  libraries?: string[]
  verbose?: boolean
}

export interface CompileResult {
  ok: boolean
  exitCode: number
  durationMs: number
  sketchDir: string
  outputDir?: string
  sizeText?: string
  errors: number
  warnings: number
}

export interface UploadRequest {
  sketchDir: string
  fqbn: string
  port: string
  verbose?: boolean
  boardOptions?: Record<string, string>
}

export interface SerialPortInfo {
  port: string
  description?: string
}

export interface OutputEvent {
  runId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface RunStartedEvent {
  runId: string
  kind: 'compile' | 'upload' | 'cli' | 'setup'
  title: string
}

export interface RunDoneEvent {
  runId: string
  ok: boolean
  exitCode: number
  durationMs: number
  kind: 'compile' | 'upload' | 'cli' | 'setup'
}

export interface ProgressEvent {
  task: string
  percent?: number
  detail?: string
}

export interface MonitorDataEvent {
  port: string
  text: string
  kind?: 'data' | 'error' | 'info'
}

export interface MonitorStateEvent {
  running: boolean
  port?: string
  baud?: number
  error?: string
}

/* ---------------------------------------------------------------- ai chat */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface AiToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  toolCalls?: AiToolCall[]
  toolCallId?: string
  name?: string
  createdAt?: number
  pending?: boolean
  error?: string
}

export interface AiChatRequest {
  requestId: string
  messages: ChatMessage[]
}

export interface AiChunkEvent {
  requestId: string
  delta: string
}

export interface AiToolCallsEvent {
  requestId: string
  calls: AiToolCall[]
}

export interface AiDoneEvent {
  requestId: string
  ok: boolean
  error?: string
  content?: string
  finishReason?: string
}

export type AiToolName =
  | 'read_file'
  | 'write_file'
  | 'create_file'
  | 'delete_file'
  | 'list_dir'
  | 'edit_file'
  | 'list_libraries'
  | 'run_python'
  | 'run_shell'
  | 'web_search'
  | 'web_fetch'
  | 'update_plan'

export type AiPlanStepStatus = 'pending' | 'in_progress' | 'done' | 'failed'

export interface AiPlanStep {
  id: string
  title: string
  status: AiPlanStepStatus
  note?: string
}

export interface AiPlan {
  title: string
  steps: AiPlanStep[]
  updatedAt: number
}

export interface AiExecToolRequest {
  name: AiToolName
  /** Raw JSON arguments as produced by the model. */
  args: Record<string, unknown>
}

export interface AiExecToolResult {
  ok: boolean
  result?: string
  error?: string
}

/* --------------------------------------------------------------- utilities */

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  platform: string
  userData: string
  home: string
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

export interface WorkspaceSearchResult {
  path: string
  line: number
  column: number
  preview: string
}

export interface AppEventMap {
  'arduino:output': OutputEvent
  'arduino:run-started': RunStartedEvent
  'arduino:run-done': RunDoneEvent
  'arduino:progress': ProgressEvent
  'monitor:data': MonitorDataEvent
  'monitor:state': MonitorStateEvent
  'cli:status': CliStatus
  'ai:chunk': AiChunkEvent
  'ai:tools': AiToolCallsEvent
  'ai:done': AiDoneEvent
  'ai:plan': AiPlan | null
  'project:changed': ProjectInfo | null
  'project:fs-changed': { root: string; time: number }
  'app:menu': { action: string }
  'app:toast': { kind: 'info' | 'error' | 'success' | 'warning'; message: string }
}

export type EmitFn = <K extends keyof AppEventMap>(channel: K, payload: AppEventMap[K]) => void
