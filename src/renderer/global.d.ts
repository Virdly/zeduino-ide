import type { ZedArduinoApi } from '../shared/api'

declare global {
  interface Window {
    api: ZedArduinoApi
  }
}

export {}
