// §3-Zeile "Metadata" durch die ECHTE UI: Sidebar-Metadaten, Titel+Autor aendern, speichern.
// Assert (pikepdf auf GET /document/file): geschriebene Werte lesbar zurueck; die NICHT
// bearbeiteten Felder (Creator, Producer) sind unveraendert erhalten — "no other metadata
// field was cleared".
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

let file: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-meta-'))
  file = path.join(dir, 'meta.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nd.new_page()\nd.set_metadata({'title':'URSPRUNG','author':'UR-AUTOR','subject':'UR-SUBJEKT','keywords':'ur,wort','creator':'CREATOR-FIX','producer':'PRODUCER-FIX'})\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Meta-Felder schreiben: Werte lesbar, Creator/Producer bleiben', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })

  await page.getByTestId('sidebar-tab-metadata').click()
  const title = page.getByTestId('meta-field-title')
  await expect(title).toBeVisible({ timeout: 10_000 })
  // Geladene Werte sichtbar (Read-Pfad) — dann Titel/Autor aendern und speichern.
  await expect(title).toHaveValue('URSPRUNG', { timeout: 10_000 })
  await title.fill('NEUER-TITEL')
  await page.getByTestId('meta-field-author').fill('NEUER-AUTOR')
  await page.getByTestId('meta-save').click()
  const PY = `
import sys, urllib.request, pikepdf, io
req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})
raw=urllib.request.urlopen(req).read()
d=pikepdf.open(io.BytesIO(raw))
info=d.docinfo
def g(k):
    v=info.get(k)
    return str(v) if v is not None else ''
print(g('/Title'), '|', g('/Author'), '|', g('/Creator'), '|', g('/Producer'), '|', g('/Subject'))
`
  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY, BACKEND, TOKEN])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toContain('NEUER-TITEL | NEUER-AUTOR | CREATOR-FIX | PRODUCER-FIX')
})
