// Startet das ECHTE Python-Backend (Port 0, Listening-Zeile als erste stdout-Zeile) und
//exportiert URL+Token über process.env für die Browser-Specs. Nur aktiv bei E2E_BROWSER=1,
// damit das Electron-Smoke-Projekt unverändert ohne Backend läuft.
import { spawn, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as os from 'node:os'

const TOKEN = 'e2e-local-token'

export default async function globalSetup(): Promise<() => void> {
  if (process.env['E2E_BROWSER'] !== '1') return () => undefined
  const root = path.resolve(__dirname, '../../..')
  const py = path.join(root, 'backend', '.venv', 'bin', 'python')
  const trustDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-e2e-trust-"))
  const child: ChildProcess = spawn(py, ["main.py"], {
    cwd: path.join(root, 'backend'),
    env: { ...process.env, PDF_EDITOR_BACKEND_TOKEN: TOKEN, BF_TRUST_ANCHORS_DIR: trustDir },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  const url = await new Promise<string>((resolve, reject) => {
    const rl = readline.createInterface({ input: child.stdout as NodeJS.ReadableStream })
    const tee = fs.createWriteStream('/tmp/bf-e2e-backend.log')
    ;(child.stdout as NodeJS.ReadableStream).on('data', (d) => tee.write(d as Buffer))
    const timer = setTimeout(() => reject(new Error('Backend-Line nicht erhalten')), 20_000)
    rl.once('line', (line) => {
      clearTimeout(timer)
      const j = JSON.parse(line) as { port: number }
      resolve(`http://127.0.0.1:${j.port}`)
    })
    child.on('exit', (code) => reject(new Error(`Backend exit ${code}`)))
  })
  process.env['E2E_BACKEND_URL'] = url
  process.env['E2E_BACKEND_TOKEN'] = TOKEN
  return () => {
    child.kill('SIGTERM')
    try { fs.rmSync(trustDir, { recursive: true, force: true }) } catch { /* egal */ }
  }
}
