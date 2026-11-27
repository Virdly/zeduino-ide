import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const root = process.cwd()
const electronDir = path.join(root, 'node_modules', 'electron', 'dist')
const appOut = path.join(root, 'release', 'ZedArduinoIDE')
const appResources = path.join(appOut, 'resources', 'app')
const exeName = 'ZedArduinoIDE.exe'

if (!fs.existsSync(path.join(electronDir, 'electron.exe'))) {
  console.error('Electron runtime not found. Expected node_modules/electron/dist/electron.exe')
  process.exit(1)
}
if (!fs.existsSync(path.join(root, 'dist', 'renderer', 'index.html'))) {
  console.error('Renderer build missing. Run "npm run build" first.')
  process.exit(1)
}

console.log('[package] cleaning', appOut)
await fsp.rm(appOut, { recursive: true, force: true })
await fsp.mkdir(appResources, { recursive: true })

console.log('[package] copying Electron runtime')
for (const entry of await fsp.readdir(electronDir, { withFileTypes: true })) {
  if (entry.name === 'resources' || entry.name === 'electron.exe') continue
  const src = path.join(electronDir, entry.name)
  const dest = path.join(appOut, entry.name)
  if (entry.isDirectory()) await fsp.cp(src, dest, { recursive: true })
  else await fsp.copyFile(src, dest)
}
await fsp.copyFile(path.join(electronDir, 'electron.exe'), path.join(appOut, exeName))

console.log('[package] copying app files')
for (const item of ['dist']) {
  const src = path.join(root, item)
  if (!fs.existsSync(src)) continue
  const dest = path.join(appResources, item)
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.cp(src, dest, { recursive: true })
}

const installedVersion = JSON.parse(await fsp.readFile(path.join(root, 'node_modules', 'serialport', 'package.json'), 'utf8')).version
const appPackage = {
  name: 'zeduino-ide',
  productName: 'ZedArduino IDE',
  version: JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8')).version,
  description: 'Zed-style editor with Arduino IDE tooling',
  main: 'dist/main/index.js',
  author: 'ZedArduino',
  dependencies: { serialport: installedVersion },
}
await fsp.writeFile(path.join(appResources, 'package.json'), JSON.stringify(appPackage, null, 2))

console.log('[package] copying docs, examples and helper scripts')
for (const file of ['README.md', 'HOW-TO-RUN.txt', 'install.ps1', 'uninstall.ps1', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
  const src = path.join(root, file)
  if (fs.existsSync(src)) await fsp.copyFile(src, path.join(appOut, file))
}
const examplesSrc = path.join(root, 'examples')
if (fs.existsSync(examplesSrc)) {
  await fsp.cp(examplesSrc, path.join(appOut, 'examples'), { recursive: true })
}
const toolsSrc = path.join(root, 'tools')
if (fs.existsSync(toolsSrc)) {
  await fsp.cp(toolsSrc, path.join(appOut, 'tools'), { recursive: true })
}

console.log('[package] copying runtime node modules (serialport)')
const list = execFileSync('npm', ['ls', '--omit=dev', '--parseable', '--all'], {
  cwd: root,
  shell: true,
  encoding: 'utf8',
})
const nodeModulesRoot = path.join(root, 'node_modules')
const nodeModulesOut = path.join(appResources, 'node_modules')
let copiedModules = 0
for (const rawLine of list.split(/\r?\n/)) {
  const pkgPath = rawLine.trim()
  if (!pkgPath) continue
  const rel = path.relative(nodeModulesRoot, pkgPath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue
  const dest = path.join(nodeModulesOut, rel)
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.cp(pkgPath, dest, { recursive: true })
  copiedModules++
}
console.log(`[package] copied ${copiedModules} runtime modules`)

// A branded shortcut with our own icon (the electron.exe carries the default icon)
const iconPath = path.join(root, 'resources', 'icon.ico')
if (fs.existsSync(iconPath)) {
  await fsp.copyFile(iconPath, path.join(appOut, 'icon.ico'))
  const lnk = path.join(appOut, 'ZedArduino IDE.lnk')
  const ps = [
    '$ws = New-Object -ComObject WScript.Shell',
    `$s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')`,
    `$s.TargetPath = '${path.join(appOut, exeName).replace(/'/g, "''")}'`,
    `$s.WorkingDirectory = '${appOut.replace(/'/g, "''")}'`,
    `$s.IconLocation = '${path.join(appOut, 'icon.ico').replace(/'/g, "''")}'`,
    `$s.Description = 'ZedArduino IDE'`,
    '$s.Save()',
  ].join('; ')
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  } catch (err) {
    console.warn('[package] shortcut creation failed:', err.message)
  }
}

console.log('[package] done ->', appOut)
