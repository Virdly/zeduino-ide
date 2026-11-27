import { createRequire } from 'node:module'
import type { MonitorDataEvent, MonitorStateEvent } from '../shared/types'

type EmitData = (e: MonitorDataEvent) => void
type EmitState = (e: MonitorStateEvent) => void

export interface SerialBackend {
  readonly kind: 'native' | 'cli'
  readonly supportsWrite: boolean
  start(): Promise<void>
  stop(): Promise<void>
  write(text: string): Promise<void>
}

interface SerialPortLike {
  on(event: string, cb: (arg: unknown) => void): void
  open(cb: (err?: Error | null) => void): void
  close(cb?: (err?: Error | null) => void): void
  write(data: string | Buffer, cb?: (err?: Error | null) => void): boolean
  isOpen?: boolean
  set?(opts: Record<string, unknown>, cb?: (err?: Error | null) => void): void
}

function loadSerialport(): { SerialPort: new (opts: Record<string, unknown>) => SerialPortLike } | null {
  try {
    const req = createRequire(__filename)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = req('serialport')
    if (mod && typeof mod.SerialPort === 'function') return mod
    return null
  } catch (err) {
    console.warn('[serial] native serialport backend unavailable:', (err as Error).message)
    return null
  }
}

class NativeSerialBackend implements SerialBackend {
  readonly kind = 'native' as const
  readonly supportsWrite = true
  private port: SerialPortLike | null = null

  constructor(
    private path: string,
    private baud: number,
    private onData: EmitData,
    private onError: (err: Error) => void,
    private SerialPortCtor: new (opts: Record<string, unknown>) => SerialPortLike,
  ) {}

  async start(): Promise<void> {
    const port = new this.SerialPortCtor({ path: this.path, baudRate: this.baud, autoOpen: false })
    this.port = port
    await new Promise<void>((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()))
    })
    port.on('data', (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      this.onData({ port: this.path, text, kind: 'data' })
    })
    port.on('error', (err) => this.onError(err instanceof Error ? err : new Error(String(err))))
  }

  async stop(): Promise<void> {
    const port = this.port
    this.port = null
    if (!port) return
    await new Promise<void>((resolve) => {
      try {
        port.close(() => resolve())
      } catch {
        resolve()
      }
    })
  }

  async write(text: string): Promise<void> {
    if (!this.port) throw new Error('Порт не открыт')
    await new Promise<void>((resolve, reject) => {
      this.port!.write(text, (err) => (err ? reject(err) : resolve()))
    })
  }
}

export class SerialMonitorService {
  private backend: SerialBackend | null = null
  private state: MonitorStateEvent = { running: false }
  private emitData: EmitData = () => {}
  private emitState: EmitState = () => {}

  constructor(
    private cliRunner: (port: string, baud: number, onData: (text: string, kind: 'data' | 'error') => void) => SerialBackend,
  ) {}

  bind(emitData: EmitData, emitState: EmitState): void {
    this.emitData = emitData
    this.emitState = emitState
  }

  getState(): MonitorStateEvent {
    return this.state
  }

  async start(port: string, baud: number): Promise<void> {
    await this.stop()
    this.state = { running: false, port, baud }
    const native = loadSerialport()
    let backend: SerialBackend
    if (native) {
      backend = new NativeSerialBackend(
        port,
        baud,
        (e) => this.emitData(e),
        (err) => this.handleError(err),
        native.SerialPort,
      )
    } else {
      backend = this.cliRunner(port, baud, (text, kind) => this.emitData({ port, text, kind }))
    }
    this.backend = backend
    try {
      await backend.start()
      this.state = { running: true, port, baud }
      this.emitState(this.state)
      this.emitData({ port, text: `--- Порт ${port} открыт (${baud} бод) ---\r\n`, kind: 'info' })
    } catch (err) {
      this.backend = null
      const message = (err as Error).message || 'Не удалось открыть порт'
      this.state = { running: false, port, baud, error: message }
      this.emitState(this.state)
      throw err
    }
  }

  private handleError(err: Error): void {
    this.emitData({ port: this.state.port || '', text: `\r\n[ошибка порта] ${err.message}\r\n`, kind: 'error' })
  }

  async stop(): Promise<void> {
    const backend = this.backend
    this.backend = null
    if (backend) {
      try {
        await backend.stop()
      } catch {
        /* ignore */
      }
    }
    if (this.state.running || this.state.port) {
      this.state = { running: false, port: this.state.port, baud: this.state.baud }
      this.emitState(this.state)
    }
  }

  async send(text: string): Promise<void> {
    if (!this.backend) throw new Error('Монитор порта не запущен')
    if (!this.backend.supportsWrite) throw new Error('Отправка недоступна в текущем режиме')
    await this.backend.write(text)
  }
}
