import type { Lang } from '../../shared/types'
import { common } from './common'
import { shell } from './shell'
import { dialogs } from './dialogs'
import { ai } from './ai'
import { editor } from './editor'

export type Dict = Record<Lang, Record<string, string>>

function merge(...parts: Dict[]): Dict {
  const out: Dict = { ru: {}, en: {} }
  for (const part of parts) {
    Object.assign(out.ru, part.ru)
    Object.assign(out.en, part.en)
  }
  return out
}

export const dictionary = merge(common, shell, dialogs, ai, editor)

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

export function createTranslator(lang: Lang): TranslateFn {
  const table = dictionary[lang] ?? dictionary.ru
  const fallback = dictionary.ru
  return (key, vars) => {
    let text = table[key] ?? fallback[key] ?? key
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}
