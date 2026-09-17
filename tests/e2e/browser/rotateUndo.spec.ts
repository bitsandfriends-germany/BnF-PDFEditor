// Browser-E2E (§3): echte UI (Chromium + Vite-Renderer), echtes Python-Backend, echte Dateien.
// Nur die native Dialog-Schicht ist gestubbted. Nach dem Klick wird das Dokument auf der Platte
// mit der ZWEITEN Bibliothek (pikepdf) gegengeprüft — nicht der Klick, das Ergebnis zählt.
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { installBridgeStub, setDialogPaths } from './bridge'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

async function python(code: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(py, ['-c', code, ...args])
  return stdout.trim()
}

test.describe('Browser-E2E: Rotieren + Undo am echten Dokument', () => {
  let file: string

  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-'))
    file = path.join(dir, 'fixture.pdf')
    await python(
      `import sys, fitz\nd=fitz.open(); p1=d.new_page(); p1.insert_text((72,72),'P1MARK')\np2=d.new_page(); p2.insert_text((72,72),'P2MARK')\np3=d.new_page(); p3.insert_text((72,72),'P3MARK')\nd.save(sys.argv[1]); d.close()`,
      file
    )
  })

  test('Klick auf Rechts-drehen dreht Seite 1 um 90°; Undo stellt bytes genau wieder her', async ({ page }) => {
    await installBridgeStub(page, BACKEND, TOKEN)
    await setDialogPaths(page, file)
    await page.goto('http://localhost:5199/')

    // Echtes Oeffnen ueber den echten Open-Knopf (Dialog gibt Fixture-Pfad zurueck).
    await page.getByTestId('tb-open').click()
    await expect(page.getByTestId('page-count')).toContainText('3', { timeout: 30_000 })

    // Arbeitsstand VOR der Operation (bytes des offenen Dokuments ueber denselben Endpunkt wie UI).
    const beforePath = file + '.before'
    await run(py, ['-c', `import sys, urllib.request\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nopen(sys.argv[3],"wb").write(urllib.request.urlopen(req).read())`, BACKEND, TOKEN, beforePath])

    // Echter Toolbar-Klick: wirken auf die aktuelle Seite (1).
    await page.getByTestId('pg-rot-right').click()
    await expect(page.getByTestId('tb-undo')).toBeEnabled({ timeout: 20_000 })

    // Gegeneprüfung mit pikepdf (unabhaengig von PyMuPDF) gegen den Arbeitsstand.
    const check = await python(
      `import sys, urllib.request, pikepdf, io\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nraw=urllib.request.urlopen(req).read()\nopen(sys.argv[3],"wb").write(raw)\np=pikepdf.open(io.BytesIO(raw))\nprint(len(p.pages), p.pages[0].get("/Rotate", 0), p.pages[1].get("/Rotate", 0))`,
      BACKEND, TOKEN, file + '.after'
    )
    expect(check).toBe('3 90 0')

    // Undo ueber den echten Knopf -> Dokument bytes-identisch zum Stand vor der Operation.
    await page.getByTestId('tb-undo').click()
    await expect(page.getByTestId('tb-undo')).toBeDisabled({ timeout: 20_000 })
    const afterUndo = await python(
      `import sys, urllib.request, hashlib\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nprint(hashlib.sha256(urllib.request.urlopen(req).read()).hexdigest())`,
      BACKEND, TOKEN
    )
    const beforeHash = await python(`import sys, hashlib\nprint(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())`, beforePath)
    expect(afterUndo).toBe(beforeHash)
  })
})
