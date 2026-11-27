import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const root = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseDir = path.join(root, 'release')
const appDir = path.join(releaseDir, 'ZedArduinoIDE')
const out = path.join(releaseDir, `ZedArduinoIDE-${pkg.version}-win64.zip`)

if (!fs.existsSync(path.join(appDir, 'ZedArduinoIDE.exe'))) {
  console.error('[zip] Portable build not found. Run "npm run package" first.')
  process.exit(1)
}

fs.rmSync(out, { force: true })
console.log('[zip] creating', out)
execFileSync('tar', ['-a', '-c', '-f', out, '-C', releaseDir, 'ZedArduinoIDE'], { stdio: 'inherit' })
const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(1)
console.log(`[zip] done: ${out} (${sizeMb} MB)`)
