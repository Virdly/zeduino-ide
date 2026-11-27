import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface RunOptions {
  env?: NodeJS.ProcessEnv
  cwd?: string
  timeoutMs?: number
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Run a command and capture output (used for short arduino-cli queries). */
export function runCommand(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(cmd, args, {
        env: { ...process.env, ...opts.env },
        cwd: opts.cwd,
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams
    } catch (err) {
      reject(err)
      return
    }
    let stdout = ''
    let stderr = ''
    let finished = false
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          if (!finished) {
            child.kill()
            reject(new Error(`Command timed out: ${cmd} ${args.join(' ')}`))
          }
        }, opts.timeoutMs)
      : null

    child.stdout.on('data', (d) => {
      if (stdout.length < 64_000_000) stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d) => {
      if (stderr.length < 4_000_000) stderr += d.toString('utf8')
    })
    child.on('error', (err) => {
      finished = true
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      finished = true
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 0, stdout, stderr })
    })
  })
}

export interface StreamHandle {
  promise: Promise<RunResult>
  kill: () => void
  pid?: number
}

/** Spawn a long running process (compile/upload/monitor) and stream its output. */
export function spawnStream(
  cmd: string,
  args: string[],
  opts: RunOptions,
  onData: (stream: 'stdout' | 'stderr', text: string) => void,
): StreamHandle {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...opts.env },
    cwd: opts.cwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams

  const decode = (d: Buffer) => d.toString('utf8')
  child.stdout.on('data', (d) => onData('stdout', decode(d)))
  child.stderr.on('data', (d) => onData('stderr', decode(d)))

  const promise = new Promise<RunResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += decode(d)))
    child.stderr.on('data', (d) => (stderr += decode(d)))
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + '\n' + String(err) })
    })
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })

  return {
    promise,
    kill: () => {
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        /* ignore */
      }
    },
    pid: child.pid ?? undefined,
  }
}

export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (percent: number, received: number, total: number) => void,
): Promise<void> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'ZedArduino-IDE' },
  })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${url}`)
  }
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.part`
  const nodeStream = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream)
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (onProgress) {
      const percent = total ? Math.round((received / total) * 100) : 0
      onProgress(percent, received, total)
    }
  })
  await pipeline(nodeStream, fs.createWriteStream(tmp))
  await fsp.rename(tmp, dest)
}

/** Extract a .zip archive using the built in bsdtar of Windows 10/11. */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true })
  const res = await runCommand('tar', ['-xf', zipPath, '-C', destDir], { timeoutMs: 180_000 })
  if (res.code !== 0) {
    throw new Error(`Не удалось распаковать архив: ${res.stderr || res.stdout}`)
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

export function slugify(input: string): string {
  const base = input
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return `${base.slice(0, 40) || 'build'}-${(hash >>> 0).toString(16)}`
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, '')
}
