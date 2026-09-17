// §3-Zeile "Redaction" durch die ECHTE UI: Text 'GEHEIM123' in der Textebene per Mausgeste
// selektieren, Rechtsklick -> ts-redact. Assert (pymupdf + pikepdf auf GET /document/file):
// der geschwaerzte String ist aus dem Textlayer NICHT MEHR extrahierbar (der Kern der
// Funktion), 'SICHERTEXT' bleibt vollstaendig, Seitenzahl unveraendert.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-red-'))
  file = path.join(dir, 'secret.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\np=d.new_page(width=595,height=842)\np.insert_text((72,200),'GEHEIM123',fontsize=24)\np.insert_text((72,300),'SICHERTEXT',fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Auswahl-Rechtsklick-Schwaerzung: String nicht mehr extrahierbar, Rest heil', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })

  const span = page.locator('text=GEHEIM123').first()
  await expect(span).toBeVisible({ timeout: 20_000 })
  const sb = await span.boundingBox()
  expect(sb).not.toBeNull()
  // Wort per Mausgeste in der Textebene selektieren.
  await page.mouse.move(sb!.x + 2, sb!.y + sb!.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb!.x + sb!.width - 2, sb!.y + sb!.height / 2, { steps: 8 })
  await page.mouse.up()

  // Rechtsklick auf die Selektion -> Kontextmenue mit ts-redact (§6-Kernpfad, destruktiv unten).
  await page.mouse.click(sb!.x + sb!.width / 2, sb!.y + sb!.height / 2, { button: 'right' })
  const redactBtn = page.getByTestId('ctx-ts-redact')
  await expect(redactBtn).toBeVisible({ timeout: 10_000 })
  await redactBtn.click()

  const PY = `
import sys, urllib.request, pymupdf, pikepdf, io
req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})
raw=urllib.request.urlopen(req).read()
d=pymupdf.open('pdf', io.BytesIO(raw))
txt=''.join(pg.get_text() for pg in d)
p=pikepdf.open(io.BytesIO(raw))
print(len(p.pages), 'GEHEIM123' in txt, 'SICHERTEXT' in txt)
`
  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY, BACKEND, TOKEN])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toBe('1 False True')
})
