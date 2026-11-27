import type { ThemeColors } from './types'

export const DARK_COLORS: ThemeColors = {
  bg: '#1b1d21',
  bgElevated: '#23262b',
  bgPanel: '#1f2226',
  bgHover: '#2a2e34',
  bgActive: '#32373e',
  border: '#31363d',
  text: '#d7dae0',
  textMuted: '#8b93a1',
  accent: '#4c9aff',
  accentText: '#ffffff',
  selection: '#2f4c78',
  error: '#f14c4c',
  warning: '#e5c07b',
  success: '#4ec9b0',
  info: '#56b6c2',
  editorBg: '#17191d',
  editorText: '#d7dae0',
  editorGutter: '#5a6270',
  editorCursor: '#7aa2f7',
  editorSelection: '#28405f',
}

export const LIGHT_COLORS: ThemeColors = {
  bg: '#f4f5f7',
  bgElevated: '#ffffff',
  bgPanel: '#eef0f3',
  bgHover: '#e6e9ee',
  bgActive: '#dbe0e7',
  border: '#d3d8e0',
  text: '#1f2430',
  textMuted: '#687182',
  accent: '#2563eb',
  accentText: '#ffffff',
  selection: '#c9dcff',
  error: '#c62828',
  warning: '#9a6700',
  success: '#0f7b5f',
  info: '#0b6e8a',
  editorBg: '#ffffff',
  editorText: '#1f2430',
  editorGutter: '#96a0b0',
  editorCursor: '#2563eb',
  editorSelection: '#cfe0ff',
}

/** Convert #rrggbb (+alpha 0..1) to rgba(). */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = Number.parseInt(full, 16)
  if (Number.isNaN(num)) return hex
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function mixColors(a: string, b: string, amount: number): string {
  const parse = (hex: string) => {
    const clean = hex.replace('#', '')
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
    const num = Number.parseInt(full, 16)
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
  }
  const c1 = parse(a)
  const c2 = parse(b)
  const r = Math.round(c1.r + (c2.r - c1.r) * amount)
  const g = Math.round(c1.g + (c2.g - c1.g) * amount)
  const blue = Math.round(c1.b + (c2.b - c1.b) * amount)
  return `#${[r, g, blue].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function isLight(color: string): boolean {
  const clean = color.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const num = Number.parseInt(full, 16)
  if (Number.isNaN(num)) return false
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return (r * 299 + g * 587 + b * 114) / 1000 > 150
}
