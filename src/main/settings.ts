import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/defaults'
import type { AppSettings } from '../shared/types'

export { DARK_COLORS, LIGHT_COLORS } from '../shared/theme'
export { DEFAULT_SETTINGS }

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T)) as T
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = out[key]
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value
  }
  return out as T
}

class SettingsStore {
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS)
  private file = ''

  init(): void {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'settings.json')
    this.load()
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const text = fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')
        const raw = JSON.parse(text)
        this.settings = deepMerge(structuredClone(DEFAULT_SETTINGS), raw)
      }
    } catch (err) {
      console.error('[settings] failed to load, using defaults', err)
    }
    this.settings.recentProjects = (this.settings.recentProjects || []).filter((p) => typeof p === 'string').slice(0, 12)
    if (!['ru', 'en'].includes(this.settings.language)) this.settings.language = 'ru'
    this.save()
  }

  save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.settings, null, 2), 'utf8')
    } catch (err) {
      console.error('[settings] save failed', err)
    }
  }

  get(): AppSettings {
    return this.settings
  }

  update(patch: DeepPartial<AppSettings>): AppSettings {
    this.settings = deepMerge(this.settings, patch)
    if (!['ru', 'en'].includes(this.settings.language)) this.settings.language = 'ru'
    this.save()
    return this.settings
  }

  addRecentProject(root: string): void {
    const list = [root, ...this.settings.recentProjects.filter((p) => p !== root)].slice(0, 12)
    this.settings.recentProjects = list
    this.settings.lastProject = root
    this.save()
  }
}

export const settingsStore = new SettingsStore()
