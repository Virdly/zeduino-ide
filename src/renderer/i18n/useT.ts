import { useMemo } from 'react'
import { createTranslator, type TranslateFn } from './index'
import { useApp } from '../state/store'

export function useT(): TranslateFn {
  const lang = useApp((s) => s.settings.language)
  return useMemo(() => createTranslator(lang), [lang])
}
