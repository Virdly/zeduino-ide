import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { DirEntry, FileNode, ProjectInfo, WorkspaceSearchResult } from '../shared/types'
import type { ProjectIndex } from '../shared/api'
import { settingsStore } from './settings'

const IGNORED_DIRS = new Set(['node_modules', '.git', '.zeduino', '.zed-build', '.svn', '.hg', 'dist', 'release'])
const TEXT_EXT = new Set(['.ino', '.pde', '.h', '.hpp', '.hh', '.c', '.cc', '.cpp', '.cxx', '.hxx', '.txt', '.md', '.json', '.yml', '.yaml', '.csv'])
const MAX_TREE_ENTRIES = 4000
const MAX_INDEX_FILES = 400
const MAX_INDEX_BYTES = 24 * 1024 * 1024

export class WorkspaceService {
  private root: string | null = null
  private watcher: fs.FSWatcher | null = null
  private watcherTimer: NodeJS.Timeout | null = null

  constructor(
    private emitFsChanged: () => void,
    private defaultSketchbookDir: string = '',
  ) {}

  current(): ProjectInfo | null {
    if (!this.root) return null
    return this.infoFor(this.root)
  }

  getRoot(): string | null {
    return this.root
  }

  infoFor(root: string): ProjectInfo {
    const name = path.basename(root)
    let isSketch = false
    let sketchName: string | undefined
    try {
      const ino = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.ino'))
      if (ino) {
        isSketch = true
        sketchName = ino.replace(/\.ino$/i, '')
      }
    } catch {
      /* ignore */
    }
    return { root, name, isSketch, sketchName }
  }

  async open(root: string): Promise<ProjectInfo> {
    const stat = await fsp.stat(root).catch(() => null)
    if (!stat || !stat.isDirectory()) throw new Error('Папка проекта не найдена')
    this.root = path.resolve(root)
    settingsStore.addRecentProject(this.root)
    this.watch()
    return this.infoFor(this.root)
  }

  close(): void {
    this.root = null
    this.watcher?.close()
    this.watcher = null
  }

  private watch(): void {
    this.watcher?.close()
    this.watcher = null
    if (!this.root) return
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, () => {
        if (this.watcherTimer) clearTimeout(this.watcherTimer)
        this.watcherTimer = setTimeout(() => this.emitFsChanged(), 350)
      })
    } catch (err) {
      console.warn('[workspace] watch failed', err)
    }
  }

  resolveInside(relPath: string): string {
    if (!this.root) throw new Error('Проект не открыт')
    const normalised = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
    const abs = path.resolve(this.root, normalised)
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new Error('Путь вне папки проекта')
    }
    return abs
  }

  private relative(abs: string): string {
    if (!this.root) throw new Error('Проект не открыт')
    return path.relative(this.root, abs).split(path.sep).join('/')
  }

  async tree(): Promise<FileNode[]> {
    if (!this.root) return []
    let count = 0
    const walk = async (dir: string, depth: number): Promise<FileNode[]> => {
      if (depth > 10 || count > MAX_TREE_ENTRIES) return []
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return []
      }
      const nodes: FileNode[] = []
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name, 'ru')
      })
      for (const entry of entries) {
        if (count++ > MAX_TREE_ENTRIES) break
        if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
        const abs = path.join(dir, entry.name)
        const rel = this.relative(abs)
        if (entry.isDirectory()) {
          nodes.push({ name: entry.name, path: rel, type: 'dir', children: await walk(abs, depth + 1) })
        } else {
          nodes.push({ name: entry.name, path: rel, type: 'file', ext: path.extname(entry.name).toLowerCase() })
        }
      }
      return nodes
    }
    return walk(this.root, 0)
  }

  async readFile(relPath: string): Promise<string> {
    const abs = this.resolveInside(relPath)
    const stat = await fsp.stat(abs)
    if (stat.size > 8 * 1024 * 1024) throw new Error('Файл слишком большой для редактора (>8 МБ)')
    return fsp.readFile(abs, 'utf8')
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const abs = this.resolveInside(relPath)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf8')
  }

  async createFile(relPath: string, content = ''): Promise<void> {
    const abs = this.resolveInside(relPath)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    if (fs.existsSync(abs)) throw new Error('Файл уже существует')
    await fsp.writeFile(abs, content, 'utf8')
  }

  async createFolder(relPath: string): Promise<void> {
    const abs = this.resolveInside(relPath)
    if (fs.existsSync(abs)) throw new Error('Папка уже существует')
    await fsp.mkdir(abs, { recursive: true })
  }

  async rename(relPath: string, newName: string): Promise<string> {
    const abs = this.resolveInside(relPath)
    if (!newName || /[\\/:*?"<>|]/.test(newName)) throw new Error('Недопустимое имя файла')
    const target = path.join(path.dirname(abs), newName)
    if (fs.existsSync(target)) throw new Error('Файл с таким именем уже существует')
    await fsp.rename(abs, target)
    return this.relative(target)
  }

  async remove(relPath: string): Promise<void> {
    const abs = this.resolveInside(relPath)
    if (abs === this.root) throw new Error('Нельзя удалить корень проекта')
    await fsp.rm(abs, { recursive: true, force: true })
  }

  private async walkFiles(visitor: (abs: string, rel: string, stat: fs.Stats) => Promise<void>, maxDepth = 10): Promise<void> {
    if (!this.root) return
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(abs, depth + 1)
        } else {
          let stat: fs.Stats
          try {
            stat = await fsp.stat(abs)
          } catch {
            continue
          }
          await visitor(abs, this.relative(abs), stat)
        }
      }
    }
    await walk(this.root, 0)
  }

  async index(): Promise<ProjectIndex> {
    const files: ProjectIndex['files'] = []
    let total = 0
    await this.walkFiles(async (abs, rel, stat) => {
      if (files.length >= MAX_INDEX_FILES || total >= MAX_INDEX_BYTES) return
      const ext = path.extname(abs).toLowerCase()
      if (!TEXT_EXT.has(ext)) return
      if (stat.size > 2 * 1024 * 1024) return
      try {
        const text = await fsp.readFile(abs, 'utf8')
        total += text.length
        files.push({ path: rel, text, ext })
      } catch {
        /* ignore unreadable */
      }
    })
    return { root: this.root ?? '', files, libraryHeaders: [] }
  }

  async search(query: string): Promise<WorkspaceSearchResult[]> {
    const results: WorkspaceSearchResult[] = []
    const needle = query.toLowerCase()
    if (needle.length < 2) return results
    await this.walkFiles(async (abs, rel, stat) => {
      if (results.length >= 200 || stat.size > 1024 * 1024) return
      const ext = path.extname(abs).toLowerCase()
      if (!TEXT_EXT.has(ext) && ext !== '') return
      let text: string
      try {
        text = await fsp.readFile(abs, 'utf8')
      } catch {
        return
      }
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length && results.length < 200; i++) {
        const idx = lines[i].toLowerCase().indexOf(needle)
        if (idx >= 0) {
          results.push({
            path: rel,
            line: i + 1,
            column: idx + 1,
            preview: lines[i].trim().slice(0, 240),
          })
        }
      }
    })
    return results
  }

  async listDirs(dirPath: string): Promise<DirEntry[]> {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isFile()))
      .map((e) => ({ name: e.name, path: path.join(dirPath, e.name), isDir: e.isDirectory() }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  }

  async createSketch(name: string, parentDir?: string): Promise<ProjectInfo> {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new Error('Имя скетча может содержать только латиницу, цифры, _ и -')
    }
    const base = parentDir || (this.root ? path.dirname(this.root) : settingsStore.get().arduino.sketchbookDir || this.defaultSketchbookDir)
    if (!base) throw new Error('Укажите папку для скетча')
    await fsp.mkdir(base, { recursive: true })
    const dir = path.join(base, name)
    await fsp.mkdir(dir, { recursive: true })
    const ino = path.join(dir, `${name}.ino`)
    if (!fs.existsSync(ino)) {
      const template = `void setup() {\n  // put your setup code here, to run once:\n\n}\n\nvoid loop() {\n  // put your main code here, to run repeatedly:\n\n}\n`
      await fsp.writeFile(ino, template, 'utf8')
    }
    return this.open(dir)
  }
}

export function isTextFile(relPath: string): boolean {
  return TEXT_EXT.has(path.extname(relPath).toLowerCase())
}
