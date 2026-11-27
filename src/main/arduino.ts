import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type {
  BoardDetails,
  BoardEntry,
  CliStatus,
  CompileRequest,
  CompileResult,
  ConnectedBoard,
  CoreInfo,
  EmitFn,
  LibraryInfo,
  SerialPortInfo,
  UploadRequest,
} from '../shared/types'
import { settingsStore } from './settings'
import type { SerialBackend } from './serial'
import { downloadFile, extractZip, pathExists, runCommand, slugify, spawnStream, stripAnsi, type StreamHandle } from './util'

const CLI_FALLBACK_VERSIONS = ['1.2.2', '1.1.1', '1.0.4']

export interface ArduinoServiceOptions {
  emit: EmitFn
  userDataDir: string
  documentsDir: string
}

export class ArduinoService {
  private emit: EmitFn
  private userDataDir: string
  private documentsDir: string
  private defaultSketchbook: string
  private statusCache: { status: CliStatus; at: number } | null = null
  private boardsCache: { list: BoardEntry[]; at: number } | null = null
  private ensureInFlight: Promise<CliStatus> | null = null
  private activeRun: StreamHandle | null = null
  private activeKind: 'compile' | 'upload' | 'cli' | 'setup' = 'cli'
  private monitorBackend: SerialBackend | null = null

  constructor(opts: ArduinoServiceOptions) {
    this.emit = opts.emit
    this.userDataDir = opts.userDataDir
    this.documentsDir = opts.documentsDir
    this.defaultSketchbook = this.computeDefaultSketchbook(opts.documentsDir)
  }

  /**
   * The Arduino sketchbook is usually `%USERPROFILE%\Documents\Arduino`, but
   * Documents may be redirected to OneDrive while the real sketchbook (with all
   * installed libraries) still lives in the physical Documents folder. Prefer
   * the folder that actually contains libraries.
   */
  private computeDefaultSketchbook(documentsDir: string): string {
    const home = process.env.USERPROFILE || ''
    const candidates = [
      path.join(home, 'Documents', 'Arduino'),
      path.join(home, 'Documents', 'ArduinoData'),
      path.join(documentsDir, 'Arduino'),
      path.join(home, 'OneDrive', 'Documents', 'Arduino'),
      path.join(home, 'OneDrive', 'Документы', 'Arduino'),
    ]
    const unique = [...new Set(candidates.filter(Boolean))]
    let best = ''
    let bestScore = -1
    for (const dir of unique) {
      const score = this.sketchbookScore(dir)
      if (score > bestScore) {
        bestScore = score
        best = dir
      }
    }
    return best || path.join(documentsDir, 'Arduino')
  }

  private sketchbookScore(dir: string): number {
    if (!fs.existsSync(dir)) return -1
    let score = 1
    try {
      const libs = fs.readdirSync(path.join(dir, 'libraries')).filter((n) => !n.startsWith('.'))
      score += libs.length * 10
    } catch {
      /* no libraries folder */
    }
    return score
  }

  /* ------------------------------------------------------------- paths/env */

  get cliBinary(): string {
    return path.join(this.userDataDir, 'tools', 'arduino-cli.exe')
  }

  get dataDir(): string {
    const local = process.env.LOCALAPPDATA || this.userDataDir
    return path.join(local, 'Arduino15')
  }

  get userDir(): string {
    const configured = settingsStore.get().arduino.sketchbookDir
    return configured || this.defaultSketchbook
  }

  get buildRoot(): string {
    return path.join(this.userDataDir, 'build')
  }

  private async env(): Promise<NodeJS.ProcessEnv> {
    await fsp.mkdir(this.dataDir, { recursive: true })
    await fsp.mkdir(this.userDir, { recursive: true })
    await fsp.mkdir(this.buildRoot, { recursive: true })
    const urls = settingsStore.get().arduino.additionalUrls.filter(Boolean)
    const env: NodeJS.ProcessEnv = {
      ARDUINO_DIRECTORIES_DATA: this.dataDir,
      ARDUINO_DIRECTORIES_USER: this.userDir,
      NO_COLOR: '1',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    }
    if (urls.length) env.ARDUINO_BOARD_MANAGER_ADDITIONAL_URLS = urls.join(',')
    return env
  }

  private cliCandidates(): string[] {
    const local = process.env.LOCALAPPDATA || ''
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const relative = path.join('resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe')
    const relativeOld = path.join('resources', 'app', 'node_modules', 'arduino-ide-extension', 'build', 'arduino-cli.exe')
    const bases = [
      path.join(local, 'Programs', 'Arduino IDE'),
      path.join(local, 'Programs', 'arduino-ide'),
      path.join(programFiles, 'Arduino IDE'),
      path.join(programFilesX86, 'Arduino IDE'),
    ]
    const out: string[] = []
    // Portable/offline option: arduino-cli.exe placed next to the program.
    out.push(path.join(path.dirname(process.execPath), 'tools', 'arduino-cli.exe'))
    for (const base of bases) {
      out.push(path.join(base, relative), path.join(base, relativeOld))
    }
    out.push(this.cliBinary)
    return out
  }

  async resolveCli(): Promise<string | null> {
    const configured = settingsStore.get().arduino.cliPath
    if (configured && (await pathExists(configured))) return configured
    for (const candidate of this.cliCandidates()) {
      if (await pathExists(candidate)) return candidate
    }
    try {
      const res = await runCommand('where', ['arduino-cli'], { timeoutMs: 5000 })
      const first = res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().endsWith('arduino-cli.exe'))
      if (first && (await pathExists(first))) return first
    } catch {
      /* not in PATH */
    }
    return null
  }

  private async runCliQuery(args: string[], timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
    const cli = await this.resolveCli()
    if (!cli) throw new Error('arduino-cli не установлен. Нажмите «Установить» во вкладке плат.')
    const env = await this.env()
    return runCommand(cli, [...args, '--no-color'], { env, timeoutMs })
  }

  private async runCliJson<T>(args: string[], timeoutMs = 120_000): Promise<T> {
    const res = await this.runCliQuery([...args, '--format', 'json'], timeoutMs)
    if (res.code !== 0 && !res.stdout.trim()) {
      throw new Error(this.cleanCliError(res.stderr || res.stdout) || 'Ошибка arduino-cli')
    }
    const text = res.stdout.trim()
    const jsonStart = text.indexOf('{')
    const jsonStartArr = text.indexOf('[')
    const start = jsonStart === -1 ? jsonStartArr : jsonStartArr === -1 ? jsonStart : Math.min(jsonStart, jsonStartArr)
    if (start < 0) return {} as T
    try {
      return JSON.parse(text.slice(start)) as T
    } catch {
      throw new Error('Не удалось разобрать ответ arduino-cli')
    }
  }

  cleanCliError(text: string): string {
    const cleaned = stripAnsi(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    // Drop pure progress bar lines
    const meaningful = cleaned.filter((l) => !/^[\d.]+\s*%/.test(l) && !/^(Downloading|Installing|Extracting)\b.*%/.test(l))
    return meaningful.slice(-6).join('\n')
  }

  /* ------------------------------------------------------------------ setup */

  async status(force = false): Promise<CliStatus> {
    if (!force && this.statusCache && Date.now() - this.statusCache.at < 15_000) return this.statusCache.status
    const cli = await this.resolveCli()
    const base: CliStatus = {
      installed: false,
      path: cli ?? undefined,
      userDir: this.userDir,
      dataDir: this.dataDir,
    }
    if (!cli) {
      this.statusCache = { status: base, at: Date.now() }
      return base
    }
    try {
      const env = await this.env()
      const res = await runCommand(cli, ['version', '--format', 'json', '--no-color'], { env, timeoutMs: 15_000 })
      let version = ''
      if (res.code === 0) {
        try {
          const json = JSON.parse(res.stdout)
          version = json.VersionString || json.version || ''
        } catch {
          const m = res.stdout.match(/Version:\s*([\w.\-]+)/i)
          version = m ? m[1] : res.stdout.trim().split(/\s+/).pop() || ''
        }
      }
      const status: CliStatus = { ...base, installed: res.code === 0, version, path: cli }
      if (!status.installed) status.error = this.cleanCliError(res.stderr || res.stdout)
      this.statusCache = { status, at: Date.now() }
      return status
    } catch (err) {
      const status: CliStatus = { ...base, error: (err as Error).message }
      this.statusCache = { status, at: Date.now() }
      return status
    }
  }

  async ensureCli(): Promise<CliStatus> {
    if (this.ensureInFlight) return this.ensureInFlight
    this.ensureInFlight = (async () => {
      const existing = await this.status(true)
      if (existing.installed) return existing
      this.emit('arduino:progress', { task: 'cli-download', percent: 1, detail: 'Поиск последней версии arduino-cli…' })
      const urls: string[] = []
      try {
        const res = await fetch('https://api.github.com/repos/arduino/arduino-cli/releases/latest', {
          headers: { 'User-Agent': 'ZedArduino-IDE', Accept: 'application/vnd.github+json' },
        })
        if (res.ok) {
          const json = (await res.json()) as { tag_name?: string }
          const tag = json.tag_name || ''
          const ver = tag.replace(/^v/, '')
          if (ver) urls.push(`https://github.com/arduino/arduino-cli/releases/download/${tag}/arduino-cli_${ver}_Windows_64bit.zip`)
        }
      } catch {
        /* offline / rate limit — fall through to pinned versions */
      }
      for (const v of CLI_FALLBACK_VERSIONS) {
        urls.push(`https://github.com/arduino/arduino-cli/releases/download/${v}/arduino-cli_${v}_Windows_64bit.zip`)
      }

      const toolsDir = path.join(this.userDataDir, 'tools')
      await fsp.mkdir(toolsDir, { recursive: true })
      const zipPath = path.join(toolsDir, 'arduino-cli.zip')
      let lastError: Error | null = null
      for (const url of urls) {
        try {
          this.emit('arduino:progress', { task: 'cli-download', percent: 2, detail: 'Загрузка arduino-cli…' })
          await downloadFile(url, zipPath, (percent, received, total) => {
            const mb = (received / 1024 / 1024).toFixed(1)
            const totalMb = total ? (total / 1024 / 1024).toFixed(1) : '?'
            this.emit('arduino:progress', {
              task: 'cli-download',
              percent: Math.max(2, Math.min(95, percent)),
              detail: `arduino-cli ${mb} / ${totalMb} МБ`,
            })
          })
          const tmpDir = path.join(toolsDir, 'cli-extract')
          await fsp.rm(tmpDir, { recursive: true, force: true })
          await extractZip(zipPath, tmpDir)
          const found = await findFile(tmpDir, 'arduino-cli.exe')
          if (!found) throw new Error('В архиве не найден arduino-cli.exe')
          await fsp.copyFile(found, this.cliBinary)
          await fsp.rm(zipPath, { force: true })
          await fsp.rm(tmpDir, { recursive: true, force: true })
          this.emit('arduino:progress', { task: 'cli-download', percent: 100, detail: 'arduino-cli установлен' })
          this.statusCache = null
          const status = await this.status(true)
          if (!status.installed) throw new Error(status.error || 'arduino-cli не запускается')
          return status
        } catch (err) {
          lastError = err as Error
        }
      }
      throw new Error(`Не удалось загрузить arduino-cli: ${lastError?.message ?? 'нет доступа к сети'}`)
    })()
    try {
      return await this.ensureInFlight
    } finally {
      this.ensureInFlight = null
    }
  }

  async updateIndex(): Promise<CliStatus> {
    const status = await this.status(true)
    if (!status.installed) throw new Error('arduino-cli не установлен')
    await this.streamCommand(['core', 'update-index'], 'cli', 'Обновление индекса плат и библиотек')
    const fresh = await this.status(true)
    return fresh
  }

  /* ---------------------------------------------------------------- boards */

  async boards(force = false): Promise<BoardEntry[]> {
    if (!force && this.boardsCache && Date.now() - this.boardsCache.at < 120_000) return this.boardsCache.list
    if (!(await this.status()).installed) return []
    const cli = (await this.resolveCli()) as string
    const env = await this.env()
    const res = await runCommand(cli, ['board', 'listall', '--no-color'], { env, timeoutMs: 120_000 })
    if (res.code !== 0 && !res.stdout.trim()) {
      throw new Error(this.cleanCliError(res.stderr || res.stdout) || 'Ошибка arduino-cli')
    }
    const list: BoardEntry[] = []
    for (const rawLine of res.stdout.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || /^Board Name\s+FQBN$/i.test(line)) continue
      const match = line.match(/^(.+?)\s{2,}([A-Za-z0-9_.\-]+:[A-Za-z0-9_.\-]+:[A-Za-z0-9_.\-]+)$/)
      const name = match ? match[1].trim() : line.split(/\s{2,}/)[0]
      const fqbn = match ? match[2] : (line.match(/([A-Za-z0-9_.\-]+:[A-Za-z0-9_.\-]+:[A-Za-z0-9_.\-]+)\s*$/) || [])[1]
      if (!fqbn) continue
      list.push({ name: name || fqbn, fqbn, platform: fqbn.split(':').slice(0, 2).join(':') })
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    this.boardsCache = { list, at: Date.now() }
    return list
  }

  async ports(): Promise<ConnectedBoard[]> {
    if (!(await this.status()).installed) return []
    type Raw = {
      detected_ports?: {
        port?: { address?: string; protocol?: string; protocol_label?: string }
        matching_boards?: { name?: string; fqbn?: string }[]
      }[]
    }
    const data = await this.runCliJson<Raw>(['board', 'list'], 30_000)
    const out: ConnectedBoard[] = []
    for (const entry of data.detected_ports || []) {
      const address = entry.port?.address
      if (!address) continue
      const board = entry.matching_boards?.[0]
      out.push({
        port: address,
        protocol: entry.port?.protocol,
        fqbn: board?.fqbn,
        boardName: board?.name,
        core: board?.fqbn?.split(':').slice(0, 2).join(':'),
      })
    }
    return out.sort((a, b) => a.port.localeCompare(b.port))
  }

  async serialPorts(): Promise<SerialPortInfo[]> {
    if (await pathExists(this.cliBinary)) {
      try {
        const ports = await this.ports()
        if (ports.length) return ports.map((p) => ({ port: p.port, description: p.boardName || p.protocol }))
      } catch {
        /* fall back to windows enumeration */
      }
    }
    try {
      const res = await runCommand('powershell.exe', ['-NoProfile', '-Command', '[System.IO.Ports.SerialPort]::GetPortNames()'], {
        timeoutMs: 10_000,
      })
      return res.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((port) => ({ port }))
    } catch {
      return []
    }
  }

  async boardDetails(fqbn: string): Promise<BoardDetails> {
    type Raw = {
      fqbn?: string
      name?: string
      config_options?: { option?: string; option_label?: string; values?: { value?: string; value_label?: string; selected?: boolean }[] }[]
    }
    const data = await this.runCliJson<Raw>(['board', 'details', '-b', fqbn], 60_000)
    return {
      fqbn: data.fqbn || fqbn,
      name: data.name || fqbn,
      options: (data.config_options || []).map((o) => ({
        id: o.option || '',
        label: o.option_label || o.option || '',
        values: (o.values || []).map((v) => ({ value: v.value || '', label: v.value_label || v.value || '', selected: v.selected })),
      })),
      defaultFqbn: data.fqbn || fqbn,
    }
  }

  /* ----------------------------------------------------------------- cores */

  async cores(): Promise<CoreInfo[]> {
    if (!(await this.status()).installed) return []
    type Raw = {
      platforms?: {
        id?: string
        installed_version?: string
        latest_version?: string
        name?: string
        metadata?: { name?: string }
      }[]
    }
    const data = await this.runCliJson<Raw>(['core', 'list'], 90_000)
    return (data.platforms || []).map((p) => ({
      id: p.id || '',
      name: p.name || p.metadata?.name || p.id || '',
      installedVersion: p.installed_version,
      latestVersion: p.latest_version,
    }))
  }

  async coreSearch(query: string): Promise<CoreInfo[]> {
    if (!(await this.status()).installed) return []
    type Raw = {
      platforms?: {
        id?: string
        latest_version?: string
        releases?: Record<string, { name?: string; version?: string }>
        metadata?: { name?: string }
      }[]
    }
    const args = ['core', 'search']
    if (query.trim()) args.push(query.trim())
    const data = await this.runCliJson<Raw>(args, 60_000)
    return (data.platforms || []).map((p) => {
      const releases = Object.values(p.releases || {})
      return {
        id: p.id || '',
        name: p.metadata?.name || releases[0]?.name || p.id || '',
        latestVersion: p.latest_version || releases[0]?.version,
        installedVersion: undefined,
      }
    })
  }

  async coreInstall(id: string): Promise<void> {
    await this.ensureCli()
    await this.streamCommand(['core', 'install', id], 'cli', `Установка ядра ${id}`, 'core-install')
    this.statusCache = null
    this.boardsCache = null
  }

  async coreUninstall(id: string): Promise<void> {
    await this.streamCommand(['core', 'uninstall', id], 'cli', `Удаление ядра ${id}`)
    this.statusCache = null
    this.boardsCache = null
  }

  /* ------------------------------------------------------------ libraries */

  async libraries(): Promise<LibraryInfo[]> {
    if (!(await this.status()).installed) return []
    const [cliList, extra] = await Promise.all([this.cliInstalledLibraries(), this.scanExtraLibraryDirs()])
    const seenPaths = new Set(cliList.map((lib) => normalizePath(lib.sourcePath)))
    const seenNames = new Set(cliList.map((lib) => lib.name.toLowerCase()))
    const merged: LibraryInfo[] = [...cliList]
    for (const lib of extra) {
      const dir = normalizePath(lib.sourcePath)
      if (dir && seenPaths.has(dir)) continue
      if (seenNames.has(lib.name.toLowerCase())) continue
      seenNames.add(lib.name.toLowerCase())
      merged.push(lib)
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }

  /** Libraries installed in the sketchbook (the folder arduino-cli manages). */
  private async cliInstalledLibraries(): Promise<LibraryInfo[]> {
    type Raw = {
      installed_libraries?: {
        library?: {
          name?: string
          version?: string
          author?: string
          sentence?: string
          paragraph?: string
          website?: string
          install_dir?: string
          location?: string
          source?: string
          types?: string[]
        }
      }[]
    }
    const data = await this.runCliJson<Raw>(['lib', 'list'], 90_000)
    return (data.installed_libraries || [])
      .map((entry) => entry.library)
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => ({
        name: l.name || '',
        installedVersion: l.version,
        author: l.author,
        sentence: l.sentence,
        paragraph: l.paragraph,
        website: l.website,
        location: l.location,
        sourcePath: l.install_dir,
        type: l.types?.[0],
      }))
  }

  /**
   * arduino-cli only lists libraries from the sketchbook, while the extra
   * library folders from the settings are used for compilation (`--libraries`).
   * Scan them here so the library manager shows the whole picture.
   */
  private async scanExtraLibraryDirs(): Promise<LibraryInfo[]> {
    const roots = settingsStore.get().arduino.libraryDirs.filter(Boolean)
    const result: LibraryInfo[] = []
    const seen = new Set<string>()
    const addLibrary = async (dir: string): Promise<void> => {
      const key = normalizePath(dir)
      if (seen.has(key)) return
      seen.add(key)
      const info = await readLibraryFolder(dir)
      if (info) result.push(info)
    }
    for (const rawRoot of roots) {
      const root = path.resolve(rawRoot)
      if (!(await pathExists(root))) continue
      if (await pathExists(path.join(root, 'library.properties'))) {
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
      }
    }
    return result
  }

  async libSearch(query: string): Promise<LibraryInfo[]> {
    if (!(await this.status()).installed) return []
    type Raw = {
      libraries?: {
        name?: string
        latest?: { version?: string; author?: string; sentence?: string; paragraph?: string; website?: string }
        releases?: Record<string, unknown>
      }[]
    }
    const trimmed = query.trim()
    const args = ['lib', 'search']
    if (trimmed) args.push(trimmed)
    const data = await this.runCliJson<Raw>(args, 60_000)
    return (data.libraries || []).map((l) => ({
      name: l.name || '',
      availableVersion: l.latest?.version,
      author: l.latest?.author,
      sentence: l.latest?.sentence,
      paragraph: l.latest?.paragraph,
      website: l.latest?.website,
    }))
  }

  async libInstall(name: string): Promise<void> {
    await this.ensureCli()
    await this.streamCommand(['lib', 'install', name], 'cli', `Установка библиотеки ${name}`, 'lib-install')
  }

  async libInstallZip(zipPath: string): Promise<void> {
    await this.ensureCli()
    await this.streamCommand(['lib', 'install', '--zip-path', zipPath], 'cli', `Установка библиотеки из ZIP`)
  }

  async libUninstall(name: string): Promise<void> {
    const installed = await this.libraries()
    const target = installed.find((lib) => lib.name === name)
    if (target?.location === 'customfolders') {
      throw new Error('Эта библиотека лежит в дополнительной папке — удалите её вручную в проводнике')
    }
    await this.streamCommand(['lib', 'uninstall', name], 'cli', `Удаление библиотеки ${name}`)
  }

  /* --------------------------------------------------------- compile/upload */

  private fqbnWithOptions(fqbn: string, options?: Record<string, string>): string {
    const opts = options ?? settingsStore.get().arduino.boardOptions ?? {}
    const entries = Object.entries(opts).filter(([k, v]) => k && v)
    if (!entries.length) return fqbn
    if (fqbn.split(':').length > 2) return fqbn // already carries options
    return `${fqbn}:${entries.map(([k, v]) => `${k}=${v}`).join(',')}`
  }

  private libraryDirs(): string[] {
    const dirs = new Set<string>()
    for (const dir of settingsStore.get().arduino.libraryDirs) {
      if (dir) dirs.add(dir)
    }
    return [...dirs]
  }

  async compile(req: CompileRequest): Promise<CompileResult> {
    await this.ensureCli()
    const sketchDir = path.resolve(req.sketchDir)
    const ino = await findSketchFile(sketchDir)
    if (!ino) throw new Error('В папке скетча не найден файл .ino')
    const fqbn = this.fqbnWithOptions(req.fqbn, req.boardOptions)
    if (!fqbn) throw new Error('Не выбрана плата (FQBN)')
    const buildPath = path.join(this.buildRoot, slugify(sketchDir))
    await fsp.mkdir(buildPath, { recursive: true })

    const args = ['compile', '--fqbn', fqbn, '--build-path', buildPath, '--warnings', 'default', '--no-color']
    if (req.verbose ?? settingsStore.get().arduino.compileVerbose) args.push('--verbose')
    for (const dir of [...this.libraryDirs(), ...(req.libraries || [])]) args.push('--libraries', dir)
    args.push(sketchDir)

    const started = Date.now()
    const runId = crypto.randomUUID()
    const title = `Компиляция ${path.basename(sketchDir)}`
    this.emit('arduino:run-started', { runId, kind: 'compile', title })
    this.emit('arduino:progress', { task: 'compile', percent: 5, detail: 'Компиляция…' })

    const cli = (await this.resolveCli()) as string
    const env = await this.env()
    const handle = spawnStream(cli, args, { env, cwd: sketchDir }, (stream, text) => {
      const clean = stripAnsi(text).replace(/\u0000/g, '')
      this.emit('arduino:output', { runId, stream, text: clean })
    })
    this.activeRun = handle
    this.activeKind = 'compile'
    const res = await handle.promise
    this.activeRun = null
    const durationMs = Date.now() - started
    const combined = stripAnsi(res.stdout + '\n' + res.stderr)
    const errors = countMatches(combined, /\berror:\s/g)
    const warnings = countMatches(combined, /\bwarning:\s/g)
    const sizeMatch = combined.match(/Sketch uses ([\d,]+) bytes[^\n]*/g)
    const sizeText = sizeMatch ? sizeMatch[sizeMatch.length - 1].replace(/\s+/g, ' ').trim() : undefined
    const ok = res.code === 0

    this.emit('arduino:run-done', { runId, ok, exitCode: res.code, durationMs, kind: 'compile' })
    return { ok, exitCode: res.code, durationMs, sketchDir, outputDir: buildPath, sizeText, errors, warnings }
  }

  async upload(req: UploadRequest): Promise<void> {
    await this.ensureCli()
    const sketchDir = path.resolve(req.sketchDir)
    const fqbn = this.fqbnWithOptions(req.fqbn, req.boardOptions)
    const buildPath = path.join(this.buildRoot, slugify(sketchDir))
    if (!(await pathExists(buildPath))) throw new Error('Сначала скомпилируйте скетч')
    if (!req.port) throw new Error('Не выбран порт загрузки')
    const args = ['upload', '--fqbn', fqbn, '--port', req.port, '--input-dir', buildPath, '--no-color']
    if (req.verbose ?? settingsStore.get().arduino.compileVerbose) args.push('--verbose')
    args.push(sketchDir)

    const runId = crypto.randomUUID()
    const started = Date.now()
    this.emit('arduino:run-started', { runId, kind: 'upload', title: `Загрузка ${path.basename(sketchDir)} → ${req.port}` })
    const cli = (await this.resolveCli()) as string
    const env = await this.env()
    const handle = spawnStream(cli, args, { env, cwd: sketchDir }, (stream, text) => {
      this.emit('arduino:output', { runId, stream, text: stripAnsi(text) })
    })
    this.activeRun = handle
    this.activeKind = 'upload'
    const res = await handle.promise
    this.activeRun = null
    this.emit('arduino:run-done', { runId, ok: res.code === 0, exitCode: res.code, durationMs: Date.now() - started, kind: 'upload' })
    if (res.code !== 0) {
      throw new Error(this.cleanCliError(res.stderr + '\n' + res.stdout) || 'Ошибка загрузки')
    }
  }

  async cancel(): Promise<void> {
    if (this.activeRun) {
      this.activeRun.kill()
      this.activeRun = null
      this.emit('arduino:output', { runId: 'system', stream: 'system', text: '\n[процесс остановлен пользователем]\n' })
    }
  }

  isBusy(): boolean {
    return this.activeRun !== null
  }

  private async streamCommand(args: string[], kind: 'cli' | 'setup', title: string, progressTask?: string): Promise<void> {
    await this.ensureCli()
    const cli = (await this.resolveCli()) as string
    const env = await this.env()
    const runId = crypto.randomUUID()
    const started = Date.now()
    this.emit('arduino:run-started', { runId, kind, title })
    let lastPercent = -1
    const handle = spawnStream(cli, [...args, '--no-color'], { env, cwd: this.userDataDir }, (stream, text) => {
      const clean = stripAnsi(text)
      this.emit('arduino:output', { runId, stream, text: clean })
      if (progressTask) {
        const m = clean.match(/(\d{1,3})\s*%/)
        if (m) {
          const percent = Number(m[1])
          if (percent !== lastPercent) {
            lastPercent = percent
            this.emit('arduino:progress', { task: progressTask, percent, detail: clean.trim().split(/\r?\n/).pop() })
          }
        }
      }
    })
    this.activeRun = handle
    this.activeKind = kind
    const res = await handle.promise
    this.activeRun = null
    this.emit('arduino:run-done', { runId, ok: res.code === 0, exitCode: res.code, durationMs: Date.now() - started, kind })
    if (res.code !== 0) {
      throw new Error(this.cleanCliError(res.stderr + '\n' + res.stdout) || 'Команда arduino-cli завершилась с ошибкой')
    }
  }

  /* --------------------------------------------------------------- monitor */

  createMonitorBackend(port: string, baud: number, onData: (text: string, kind: 'data' | 'error') => void): SerialBackend {
    let handle: StreamHandle | null = null
    const backend: SerialBackend = {
      kind: 'cli',
      supportsWrite: false,
      start: async () => {
        const cli = await this.resolveCli()
        if (!cli) throw new Error('arduino-cli не установлен')
        const env = await this.env()
        handle = spawnStream(cli, ['monitor', '-p', port, '-c', `baudrate=${baud}`, '--no-color'], { env, cwd: this.userDataDir }, (stream, text) => {
          onData(stripAnsi(text), stream === 'stderr' ? 'error' : 'data')
        })
        // Fail fast when the port cannot be opened
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => resolve(), 1200)
          handle!.promise.then((res) => {
            clearTimeout(timeout)
            if (res.code !== 0) reject(new Error(this.cleanCliError(res.stderr) || 'Не удалось открыть порт'))
          })
        })
      },
      stop: async () => {
        handle?.kill()
        handle = null
      },
      write: async () => {
        throw new Error('Отправка данных требует нативного модуля serialport')
      },
    }
    return backend
  }
}

async function findFile(dir: string, name: string): Promise<string | null> {
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = await findFile(abs, name)
      if (found) return found
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return abs
    }
  }
  return null
}

export async function findSketchFile(sketchDir: string): Promise<string | null> {
  try {
    const entries = await fsp.readdir(sketchDir, { withFileTypes: true })
    const ino = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.ino'))
    if (ino) return path.join(sketchDir, ino.name)
    return null
  } catch {
    return null
  }
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re)
  return m ? m.length : 0
}

function normalizePath(input?: string): string {
  if (!input) return ''
  try {
    return path
      .resolve(input)
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  } catch {
    return input.toLowerCase()
  }
}

function parsePropertyFile(text: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    map[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
  }
  return map
}

const SKIP_LIB_DIRS = new Set(['.git', 'examples', 'extras', 'docs', 'test', 'tests', 'node_modules'])

async function collectHeaders(dir: string, depth: number, acc: string[] = []): Promise<string[]> {
  if (depth < 0 || acc.length >= 300) return acc
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      if (SKIP_LIB_DIRS.has(entry.name)) continue
      await collectHeaders(path.join(dir, entry.name), depth - 1, acc)
    } else if (/\.(h|hpp|hh)$/i.test(entry.name) && !acc.includes(entry.name)) {
      acc.push(entry.name)
    }
    if (acc.length >= 300) break
  }
  return acc
}

async function readLibraryFolder(dir: string): Promise<LibraryInfo | null> {
  const nameFallback = path.basename(dir)
  const propsPath = path.join(dir, 'library.properties')
  if (await pathExists(propsPath)) {
    try {
      const props = parsePropertyFile(await fsp.readFile(propsPath, 'utf8'))
      return {
        name: props.name || nameFallback,
        installedVersion: props.version,
        author: props.author,
        sentence: props.sentence,
        paragraph: props.paragraph,
        website: props.url || props.website,
        location: 'customfolders',
        sourcePath: dir,
      }
    } catch {
      /* fall through to header scan */
    }
  }
  const headers = await collectHeaders(dir, 2)
  if (!headers.length) return null
  return {
    name: nameFallback,
    headers,
    location: 'customfolders',
    sourcePath: dir,
    sentence: headers.slice(0, 4).join(', '),
  }
}
