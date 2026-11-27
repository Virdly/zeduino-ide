import { spawn } from 'node:child_process'
import process from 'node:process'

const isWin = process.platform === 'win32'
const shell = isWin

const cleanEnv = { ...process.env }
delete cleanEnv.ELECTRON_RUN_AS_NODE

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', shell, env: cleanEnv, ...opts })
}

const mainWatcher = run('node', ['scripts/build-main.mjs', '--watch'])

const vite = run('npx', ['vite', '--port', '5178', '--strictPort'])

const url = 'http://127.0.0.1:5178'
let electronProc = null

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok || res.status === 404) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const ok = await waitForServer()
if (!ok) {
  console.error('[dev] Vite dev server did not start')
  process.exit(1)
}

electronProc = run('npx', ['electron', '.'], {
  env: { ...cleanEnv, VITE_DEV_SERVER_URL: url, ZEDUINO_DEV: '1' },
})

electronProc.on('exit', (code) => {
  mainWatcher.kill()
  vite.kill()
  process.exit(code ?? 0)
})

for (const p of [mainWatcher, vite]) {
  p.on('exit', (code) => {
    if (code && code !== 0) {
      electronProc?.kill()
      process.exit(code)
    }
  })
}
