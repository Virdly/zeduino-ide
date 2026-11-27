import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, IPC, type ZedArduinoApi } from '../shared/api'
import type {
  AiChunkEvent,
  AiDoneEvent,
  AiToolCallsEvent,
  AppEventMap,
  CompileRequest,
  MonitorStateEvent,
  OutputEvent,
  ProgressEvent,
  ProjectInfo,
  RunDoneEvent,
  RunStartedEvent,
  UploadRequest,
} from '../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  }
}

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ZedArduinoApi = {
  app: {
    info: () => invoke(IPC.appInfo),
    openExternal: (url) => invoke(IPC.appOpenExternal, url),
    openPath: (target) => invoke(IPC.appOpenPath, target),
    pickFolder: (title) => invoke(IPC.appPickFolder, title),
    pickFile: (filters) => invoke(IPC.appPickFile, filters),
    showItemInFolder: (target) => invoke(IPC.appShowItem, target),
    onMenu: (cb) => on<AppEventMap['app:menu']>(EVENT_CHANNELS.appMenu, (p) => cb(p.action)),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    reset: () => invoke(IPC.settingsReset),
  },
  project: {
    current: () => invoke(IPC.projectCurrent),
    open: (root) => invoke(IPC.projectOpen, root),
    openDialog: () => invoke(IPC.projectOpenDialog),
    close: () => invoke(IPC.projectClose),
    recent: () => invoke(IPC.projectRecent),
    tree: () => invoke(IPC.projectTree),
    readFile: (relPath) => invoke(IPC.projectReadFile, relPath),
    writeFile: (relPath, content) => invoke(IPC.projectWriteFile, relPath, content),
    createFile: (relPath, content) => invoke(IPC.projectCreateFile, relPath, content),
    createFolder: (relPath) => invoke(IPC.projectCreateFolder, relPath),
    rename: (relPath, newName) => invoke(IPC.projectRename, relPath, newName),
    remove: (relPath) => invoke(IPC.projectRemove, relPath),
    reveal: (relPath) => invoke(IPC.projectReveal, relPath),
    createSketch: (name, parentDir) => invoke(IPC.projectCreateSketch, name, parentDir),
    index: () => invoke(IPC.projectIndex),
    search: (query) => invoke(IPC.projectSearch, query),
    onChanged: (cb) => on<ProjectInfo | null>(EVENT_CHANNELS.projectChanged, cb),
    onFsChanged: (cb) => on<AppEventMap['project:fs-changed']>(EVENT_CHANNELS.projectFsChanged, () => cb()),
  },
  arduino: {
    status: (force) => invoke(IPC.arduinoStatus, force),
    ensureCli: () => invoke(IPC.arduinoEnsureCli),
    chooseCli: () => invoke(IPC.arduinoChooseCli),
    updateIndex: () => invoke(IPC.arduinoUpdateIndex),
    cores: () => invoke(IPC.arduinoCores),
    coreSearch: (query) => invoke(IPC.arduinoCoreSearch, query),
    coreInstall: (id) => invoke(IPC.arduinoCoreInstall, id),
    coreUninstall: (id) => invoke(IPC.arduinoCoreUninstall, id),
    boards: () => invoke(IPC.arduinoBoards),
    ports: () => invoke(IPC.arduinoPorts),
    serialPorts: () => invoke(IPC.arduinoSerialPorts),
    boardDetails: (fqbn) => invoke(IPC.arduinoBoardDetails, fqbn),
    compile: (req: CompileRequest) => invoke(IPC.arduinoCompile, req),
    upload: (req: UploadRequest) => invoke(IPC.arduinoUpload, req),
    cancel: () => invoke(IPC.arduinoCancel),
    libraries: () => invoke(IPC.arduinoLibraries),
    libSearch: (query) => invoke(IPC.arduinoLibSearch, query),
    libInstall: (name) => invoke(IPC.arduinoLibInstall, name),
    libInstallZip: () => invoke(IPC.arduinoLibInstallZip),
    libUninstall: (name) => invoke(IPC.arduinoLibUninstall, name),
    onProgress: (cb) => on<ProgressEvent>(EVENT_CHANNELS.arduinoProgress, cb),
    onOutput: (cb) => on<OutputEvent>(EVENT_CHANNELS.arduinoOutput, cb),
    onRunStarted: (cb) => on<RunStartedEvent>(EVENT_CHANNELS.arduinoRunStarted, cb),
    onRunDone: (cb) => on<RunDoneEvent>(EVENT_CHANNELS.arduinoRunDone, cb),
  },
  monitor: {
    start: (port, baud) => invoke(IPC.monitorStart, port, baud),
    stop: () => invoke(IPC.monitorStop),
    send: (text) => invoke(IPC.monitorSend, text),
    state: () => invoke(IPC.monitorState),
    onData: (cb) => on<AppEventMap['monitor:data']>(EVENT_CHANNELS.monitorData, cb),
    onState: (cb) => on<MonitorStateEvent>(EVENT_CHANNELS.monitorState, cb),
  },
  ai: {
    chat: (req) => invoke(IPC.aiChat, req),
    abort: (requestId) => invoke(IPC.aiAbort, requestId),
    execTool: (req) => invoke(IPC.aiExecTool, req),
    onChunk: (cb) => on<AiChunkEvent>(EVENT_CHANNELS.aiChunk, cb),
    onTools: (cb) => on<AiToolCallsEvent>(EVENT_CHANNELS.aiTools, cb),
    onDone: (cb) => on<AiDoneEvent>(EVENT_CHANNELS.aiDone, cb),
  },
  dirs: {
    list: (dirPath) => invoke(IPC.dirsList, dirPath),
  },
}

contextBridge.exposeInMainWorld('api', api)
