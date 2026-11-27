import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC, type ProjectIndex } from '../shared/api'
import type {
  AppEventMap,
  AppInfo,
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
  ProjectInfo,
  SerialPortInfo,
  UploadRequest,
  WorkspaceSearchResult,
} from '../shared/types'
import { ArduinoService } from './arduino'
import { AiService } from './ai'
import { SerialMonitorService } from './serial'
import { DEFAULT_SETTINGS, settingsStore } from './settings'
import { WorkspaceService } from './workspace'

app.setName('ZedArduino IDE')

let mainWindow: BrowserWindow | null = null
let workspace: WorkspaceService
let arduino: ArduinoService
let ai: AiService
let monitor: SerialMonitorService

function emit<K extends keyof AppEventMap>(channel: K, payload: AppEventMap[K]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function handle(channel: string, fn: (...args: any[]) => Promise<unknown> | unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      throw new Error(errorMessage(err))
    }
  })
}

const isDev = !!process.env.VITE_DEV_SERVER_URL

function createWindow(): void {
  const iconPath = path.join(__dirname, '..', 'renderer', 'icon.ico')
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1480, Math.max(960, workArea.width - 24))
  const height = Math.min(920, Math.max(600, workArea.height - 24))
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#1b1d21',
    autoHideMenuBar: false,
    title: 'ZedArduino IDE',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildMenu(): void {
  const send = (action: string) => emit('app:menu', { action })
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый скетч…', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('new-sketch') },
        { label: 'Открыть папку…', accelerator: 'CmdOrCtrl+O', click: () => send('open-folder') },
        { type: 'separator' },
        { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Сохранить все', accelerator: 'CmdOrCtrl+Alt+S', click: () => send('save-all') },
        { type: 'separator' },
        { label: 'Настройки…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', role: 'undo' },
        { label: 'Вернуть', role: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' },
        { type: 'separator' },
        { label: 'Найти', accelerator: 'CmdOrCtrl+F', click: () => send('find') },
        { label: 'Заменить', accelerator: 'CmdOrCtrl+H', click: () => send('replace') },
        { label: 'Поиск по проекту', accelerator: 'CmdOrCtrl+Shift+F', click: () => send('search-project') },
      ],
    },
    {
      label: 'Скетч',
      submenu: [
        { label: 'Проверить (компиляция)', accelerator: 'CmdOrCtrl+B', click: () => send('compile') },
        { label: 'Загрузить', accelerator: 'CmdOrCtrl+U', click: () => send('upload') },
        { type: 'separator' },
        { label: 'Монитор порта', accelerator: 'CmdOrCtrl+M', click: () => send('monitor') },
        { label: 'Последовательный плоттер', accelerator: 'CmdOrCtrl+Shift+M', click: () => send('plotter') },
        { type: 'separator' },
        { label: 'Менеджер плат…', accelerator: 'CmdOrCtrl+Shift+B', click: () => send('boards') },
        { label: 'Менеджер библиотек…', accelerator: 'CmdOrCtrl+Shift+I', click: () => send('libraries') },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Светлая тема', click: () => send('theme-light') },
        { label: 'Тёмная тема', click: () => send('theme-dark') },
        { label: 'Редактор темы…', click: () => send('theme-editor') },
        { type: 'separator' },
        { label: 'Дерево файлов', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('toggle-sidebar') },
        { label: 'Панель вывода', accelerator: 'CmdOrCtrl+`', click: () => send('toggle-panel') },
        { label: 'Чат с ИИ', accelerator: 'CmdOrCtrl+Shift+A', click: () => send('toggle-ai') },
        { type: 'separator' },
        { label: 'Увеличить масштаб', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
        { label: 'Уменьшить масштаб', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { label: 'Сбросить масштаб', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') },
        { type: 'separator' },
        { label: 'Инструменты разработчика', accelerator: 'CmdOrCtrl+Shift+F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { label: 'Полный экран', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Помощь',
      submenu: [
        { label: 'Документация Arduino', click: () => void shell.openExternal('https://docs.arduino.cc/') },
        { label: 'Справочник языка', click: () => void shell.openExternal('https://www.arduino.cc/reference/ru/') },
        { type: 'separator' },
        {
          label: 'О программе',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'ZedArduino IDE',
              message: `ZedArduino IDE ${app.getVersion()}`,
              detail:
                'Лёгкий редактор в духе Zed с инструментами Arduino IDE:\n' +
                '• платы, ядра и настройки платы\n• компиляция и загрузка\n• монитор порта\n' +
                '• библиотеки (менеджер, ZIP, свои папки)\n• автодополнение\n• чат с нейросетью (по API)\n\n' +
                'Electron ' +
                process.versions.electron +
                ' • Chromium ' +
                process.versions.chrome,
              buttons: ['OK'],
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  /* -------------------------------------------------------------------- app */
  handle(IPC.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    userData: app.getPath('userData'),
    home: app.getPath('home'),
  }))
  handle(IPC.appOpenExternal, async (url: string) => {
    if (!/^https?:/i.test(url)) throw new Error('Разрешены только http(s) ссылки')
    await shell.openExternal(url)
  })
  handle(IPC.appOpenPath, async (target: string) => {
    const res = await shell.openPath(path.resolve(target))
    if (res) throw new Error(res)
  })
  handle(IPC.appPickFolder, async (title?: string) => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: title || 'Выберите папку',
      properties: ['openDirectory', 'createDirectory'],
    })
    return res.canceled ? null : res.filePaths[0]
  })
  handle(IPC.appPickFile, async (filters?: { name: string; extensions: string[] }[]) => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Выберите файл',
      properties: ['openFile'],
      filters: filters?.length ? filters : undefined,
    })
    return res.canceled ? null : res.filePaths[0]
  })
  handle(IPC.appShowItem, (target: string) => {
    shell.showItemInFolder(path.resolve(target))
  })

  /* --------------------------------------------------------------- settings */
  handle(IPC.settingsGet, () => settingsStore.get())
  handle(IPC.settingsUpdate, (patch: Record<string, unknown>) => settingsStore.update(patch))
  handle(IPC.settingsReset, () => {
    const current = settingsStore.get()
    const next = structuredClone(DEFAULT_SETTINGS)
    next.recentProjects = current.recentProjects
    next.lastProject = current.lastProject
    return settingsStore.update(next)
  })

  /* ---------------------------------------------------------------- project */
  handle(IPC.projectCurrent, (): ProjectInfo | null => workspace.current())
  handle(IPC.projectOpen, async (root: string): Promise<ProjectInfo> => {
    const info = await workspace.open(root)
    emit('project:changed', info)
    return info
  })
  handle(IPC.projectOpenDialog, async (): Promise<ProjectInfo | null> => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Открыть папку проекта',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Открыть',
    })
    if (res.canceled || !res.filePaths[0]) return null
    const info = await workspace.open(res.filePaths[0])
    emit('project:changed', info)
    return info
  })
  handle(IPC.projectClose, () => {
    workspace.close()
    emit('project:changed', null)
  })
  handle(IPC.projectRecent, () => settingsStore.get().recentProjects)
  handle(IPC.projectTree, (): Promise<FileNode[]> => workspace.tree())
  handle(IPC.projectReadFile, (rel: string) => workspace.readFile(rel))
  handle(IPC.projectWriteFile, async (rel: string, content: string) => {
    await workspace.writeFile(rel, content)
    return true
  })
  handle(IPC.projectCreateFile, async (rel: string, content?: string) => {
    await workspace.createFile(rel, content ?? '')
    return true
  })
  handle(IPC.projectCreateFolder, async (rel: string) => {
    await workspace.createFolder(rel)
    return true
  })
  handle(IPC.projectRename, (rel: string, newName: string) => workspace.rename(rel, newName))
  handle(IPC.projectRemove, async (rel: string) => {
    await workspace.remove(rel)
    return true
  })
  handle(IPC.projectReveal, (rel: string) => {
    shell.showItemInFolder(workspace.resolveInside(rel))
  })
  handle(IPC.projectCreateSketch, async (name: string, parentDir?: string): Promise<ProjectInfo> => {
    const info = await workspace.createSketch(name, parentDir)
    emit('project:changed', info)
    return info
  })
  handle(IPC.projectIndex, (): Promise<ProjectIndex> => workspace.index())
  handle(IPC.projectSearch, (query: string): Promise<WorkspaceSearchResult[]> => workspace.search(query))

  /* ---------------------------------------------------------------- arduino */
  handle(IPC.arduinoStatus, (force?: boolean): Promise<CliStatus> => arduino.status(force))
  handle(IPC.arduinoEnsureCli, (): Promise<CliStatus> => arduino.ensureCli())
  handle(IPC.arduinoChooseCli, async (): Promise<CliStatus> => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Укажите arduino-cli.exe',
      properties: ['openFile'],
      filters: [{ name: 'arduino-cli', extensions: ['exe'] }],
    })
    if (res.canceled || !res.filePaths[0]) return arduino.status(true)
    settingsStore.update({ arduino: { cliPath: res.filePaths[0] } })
    const status = await arduino.status(true)
    if (status.installed) emit('cli:status', status)
    return status
  })
  handle(IPC.arduinoUpdateIndex, (): Promise<CliStatus> => arduino.updateIndex())
  handle(IPC.arduinoCores, (): Promise<CoreInfo[]> => arduino.cores())
  handle(IPC.arduinoCoreSearch, (query: string): Promise<CoreInfo[]> => arduino.coreSearch(query))
  handle(IPC.arduinoCoreInstall, (id: string) => arduino.coreInstall(id))
  handle(IPC.arduinoCoreUninstall, (id: string) => arduino.coreUninstall(id))
  handle(IPC.arduinoBoards, (): Promise<BoardEntry[]> => arduino.boards())
  handle(IPC.arduinoPorts, (): Promise<ConnectedBoard[]> => arduino.ports())
  handle(IPC.arduinoSerialPorts, (): Promise<SerialPortInfo[]> => arduino.serialPorts())
  handle(IPC.arduinoBoardDetails, (fqbn: string): Promise<BoardDetails> => arduino.boardDetails(fqbn))
  handle(IPC.arduinoCompile, async (req: CompileRequest): Promise<CompileResult> => {
    const sketchDir = req.sketchDir || workspace.getRoot()
    if (!sketchDir) throw new Error('Откройте папку скетча')
    await monitor.stop()
    return arduino.compile({ ...req, sketchDir })
  })
  handle(IPC.arduinoUpload, async (req: UploadRequest) => {
    const sketchDir = req.sketchDir || workspace.getRoot()
    if (!sketchDir) throw new Error('Откройте папку скетча')
    await monitor.stop()
    await arduino.upload({ ...req, sketchDir })
    return true
  })
  handle(IPC.arduinoCancel, () => arduino.cancel())
  handle(IPC.arduinoLibraries, (): Promise<LibraryInfo[]> => arduino.libraries())
  handle(IPC.arduinoLibSearch, (query: string): Promise<LibraryInfo[]> => arduino.libSearch(query))
  handle(IPC.arduinoLibInstall, (name: string) => arduino.libInstall(name))
  handle(IPC.arduinoLibInstallZip, async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Выберите ZIP-архив библиотеки',
      properties: ['openFile'],
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    })
    if (res.canceled || !res.filePaths[0]) return null
    await arduino.libInstallZip(res.filePaths[0])
    return true
  })
  handle(IPC.arduinoLibUninstall, (name: string) => arduino.libUninstall(name))

  /* ---------------------------------------------------------------- monitor */
  handle(IPC.monitorStart, async (port: string, baud: number) => {
    await monitor.start(port, baud)
    return true
  })
  handle(IPC.monitorStop, () => monitor.stop())
  handle(IPC.monitorSend, (text: string) => monitor.send(text))
  handle(IPC.monitorState, () => monitor.getState())

  /* --------------------------------------------------------------------- ai */
  handle(IPC.aiChat, (req: Parameters<AiService['chat']>[0]) => ai.chat(req))
  handle(IPC.aiAbort, (requestId: string) => ai.abort(requestId))
  handle(IPC.aiExecTool, (req: Parameters<AiService['execTool']>[0]) => ai.execTool(req))

  /* ------------------------------------------------------------------- dirs */
  handle(IPC.dirsList, async (dirPath: string): Promise<DirEntry[]> => workspace.listDirs(dirPath))

  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    settingsStore.init()
    const userData = app.getPath('userData')
    workspace = new WorkspaceService(
      () => emit('project:fs-changed', { root: workspace.getRoot() || '', time: Date.now() }),
      path.join(app.getPath('documents'), 'Arduino'),
    )
    arduino = new ArduinoService({ emit, userDataDir: userData, documentsDir: app.getPath('documents') })
    monitor = new SerialMonitorService((port, baud, onData) => arduino.createMonitorBackend(port, baud, onData))
    monitor.bind(
      (e) => emit('monitor:data', e),
      (e) => emit('monitor:state', e),
    )
    ai = new AiService(emit, workspace)

    // Restore previous project if it still exists
    const last = settingsStore.get().lastProject
    if (last && fs.existsSync(last)) {
      workspace.open(last).catch(() => undefined)
    }

    registerIpc()
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    void monitor?.stop()
    void arduino?.cancel()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}
