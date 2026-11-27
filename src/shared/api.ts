import type {
  AiChatRequest,
  AiExecToolRequest,
  AiExecToolResult,
  AppInfo,
  AppSettings,
  BoardDetails,
  BoardEntry,
  CliStatus,
  CompileRequest,
  CompileResult,
  ConnectedBoard,
  CoreInfo,
  DirEntry,
  FileNode,
  LibraryInfo,
  MonitorStateEvent,
  ProjectInfo,
  SerialPortInfo,
  UploadRequest,
  WorkspaceSearchResult,
  AppEventMap,
} from './types'

export interface ProjectIndexFile {
  path: string
  text: string
  ext: string
}

export interface ProjectIndex {
  root: string
  files: ProjectIndexFile[]
  libraryHeaders: { name: string; headers: string[] }[]
}

export interface SketchTemplateOptions {
  name: string
  parentDir: string
}

/** The API surface exposed to the renderer through the preload script. */
export interface ZedArduinoApi {
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openPath(target: string): Promise<void>
    pickFolder(title?: string): Promise<string | null>
    pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
    showItemInFolder(target: string): Promise<void>
    onMenu(cb: (action: string) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings> | Record<string, unknown>): Promise<AppSettings>
    reset(): Promise<AppSettings>
  }
  project: {
    current(): Promise<ProjectInfo | null>
    open(root: string): Promise<ProjectInfo>
    openDialog(): Promise<ProjectInfo | null>
    close(): Promise<void>
    recent(): Promise<string[]>
    tree(): Promise<FileNode[]>
    readFile(relPath: string): Promise<string>
    writeFile(relPath: string, content: string): Promise<void>
    createFile(relPath: string, content?: string): Promise<void>
    createFolder(relPath: string): Promise<void>
    rename(relPath: string, newName: string): Promise<string>
    remove(relPath: string): Promise<void>
    reveal(relPath: string): Promise<void>
    createSketch(name: string, parentDir?: string): Promise<ProjectInfo>
    index(): Promise<ProjectIndex>
    search(query: string): Promise<WorkspaceSearchResult[]>
    onChanged(cb: (info: ProjectInfo | null) => void): () => void
    onFsChanged(cb: () => void): () => void
  }
  arduino: {
    status(force?: boolean): Promise<CliStatus>
    ensureCli(): Promise<CliStatus>
    chooseCli(): Promise<CliStatus>
    updateIndex(): Promise<CliStatus>
    cores(): Promise<CoreInfo[]>
    coreSearch(query: string): Promise<CoreInfo[]>
    coreInstall(id: string): Promise<void>
    coreUninstall(id: string): Promise<void>
    boards(): Promise<BoardEntry[]>
    ports(): Promise<ConnectedBoard[]>
    serialPorts(): Promise<SerialPortInfo[]>
    boardDetails(fqbn: string): Promise<BoardDetails>
    compile(req: CompileRequest): Promise<CompileResult>
    upload(req: UploadRequest): Promise<void>
    cancel(): Promise<void>
    libraries(): Promise<LibraryInfo[]>
    libSearch(query: string): Promise<LibraryInfo[]>
    libInstall(name: string): Promise<void>
    libInstallZip(): Promise<LibraryInfo>
    libUninstall(name: string): Promise<void>
    onProgress(cb: (p: { task: string; percent?: number; detail?: string }) => void): () => void
    onOutput(cb: (e: AppEventMap['arduino:output']) => void): () => void
    onRunStarted(cb: (e: AppEventMap['arduino:run-started']) => void): () => void
    onRunDone(cb: (e: AppEventMap['arduino:run-done']) => void): () => void
  }
  monitor: {
    start(port: string, baud: number): Promise<void>
    stop(): Promise<void>
    send(text: string): Promise<void>
    state(): Promise<MonitorStateEvent>
    onData(cb: (e: AppEventMap['monitor:data']) => void): () => void
    onState(cb: (e: MonitorStateEvent) => void): () => void
  }
  ai: {
    chat(req: AiChatRequest): Promise<void>
    abort(requestId: string): Promise<void>
    execTool(req: AiExecToolRequest): Promise<AiExecToolResult>
    onChunk(cb: (e: AppEventMap['ai:chunk']) => void): () => void
    onTools(cb: (e: AppEventMap['ai:tools']) => void): () => void
    onDone(cb: (e: AppEventMap['ai:done']) => void): () => void
  }
  dirs: {
    list(dirPath: string): Promise<DirEntry[]>
  }
}

export const IPC = {
  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  appOpenPath: 'app:open-path',
  appPickFolder: 'app:pick-folder',
  appPickFile: 'app:pick-file',
  appShowItem: 'app:show-item',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  projectCurrent: 'project:current',
  projectOpen: 'project:open',
  projectOpenDialog: 'project:open-dialog',
  projectClose: 'project:close',
  projectRecent: 'project:recent',
  projectTree: 'project:tree',
  projectReadFile: 'project:read-file',
  projectWriteFile: 'project:write-file',
  projectCreateFile: 'project:create-file',
  projectCreateFolder: 'project:create-folder',
  projectRename: 'project:rename',
  projectRemove: 'project:remove',
  projectReveal: 'project:reveal',
  projectCreateSketch: 'project:create-sketch',
  projectIndex: 'project:index',
  projectSearch: 'project:search',
  arduinoStatus: 'arduino:status',
  arduinoEnsureCli: 'arduino:ensure-cli',
  arduinoChooseCli: 'arduino:choose-cli',
  arduinoUpdateIndex: 'arduino:update-index',
  arduinoCores: 'arduino:cores',
  arduinoCoreSearch: 'arduino:core-search',
  arduinoCoreInstall: 'arduino:core-install',
  arduinoCoreUninstall: 'arduino:core-uninstall',
  arduinoBoards: 'arduino:boards',
  arduinoPorts: 'arduino:ports',
  arduinoSerialPorts: 'arduino:serial-ports',
  arduinoBoardDetails: 'arduino:board-details',
  arduinoCompile: 'arduino:compile',
  arduinoUpload: 'arduino:upload',
  arduinoCancel: 'arduino:cancel',
  arduinoLibraries: 'arduino:libraries',
  arduinoLibSearch: 'arduino:lib-search',
  arduinoLibInstall: 'arduino:lib-install',
  arduinoLibInstallZip: 'arduino:lib-install-zip',
  arduinoLibUninstall: 'arduino:lib-uninstall',
  monitorStart: 'monitor:start',
  monitorStop: 'monitor:stop',
  monitorSend: 'monitor:send',
  monitorState: 'monitor:state',
  aiChat: 'ai:chat',
  aiAbort: 'ai:abort',
  aiExecTool: 'ai:exec-tool',
  dirsList: 'dirs:list',
} as const

export const EVENT_CHANNELS = {
  arduinoOutput: 'arduino:output',
  arduinoRunStarted: 'arduino:run-started',
  arduinoRunDone: 'arduino:run-done',
  arduinoProgress: 'arduino:progress',
  monitorData: 'monitor:data',
  monitorState: 'monitor:state',
  aiChunk: 'ai:chunk',
  aiTools: 'ai:tools',
  aiDone: 'ai:done',
  projectChanged: 'project:changed',
  projectFsChanged: 'project:fs-changed',
  appMenu: 'app:menu',
  appToast: 'app:toast',
  cliStatus: 'cli:status',
} as const
