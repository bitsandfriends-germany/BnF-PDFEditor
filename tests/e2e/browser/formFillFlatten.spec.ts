// §3-Zeile "Form filling" durch die ECHTE UI: Textfeld im Layer ausfuellen (blur-commit),
// Wert per pikepdf auf GET /document/file gegenlesen; dann per UI flatten (pg-flatten ->
// flatten-run) und erneut pruefen: keine Form-Felder mehr, Wert als Seiteninhalt erhalten.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-form-'))
  file = path.join(dir, 'form.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\np=d.new_page(width=595,height=842)\np.insert_text((72,80),'FORMFIX',fontsize=20)\nw=pymupdf.Widget()\nw.field_name='Feld1'\nw.field_type=pymupdf.PDF_WIDGET_TYPE_TEXT\nw.rect=pymupdf.Rect(70,140,280,165)\nw.text=''\np.add_widget(w)\nd.save(sys.argv[1]); d.close()`,
    file])
})

const PY_FIELDS = `
import sys, urllib.request, pymupdf, pikepdf, io
req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})
raw=urllib.request.urlopen(req).read()
d=pikepdf.open(io.BytesIO(raw))
af=d.Root.get('/AcroForm')
flds=list(af.get('/Fields')) if af else []
v=str(flds[0].get('/V')) if flds else 'NOFIELD'
t=pymupdf.open('pdf', io.BytesIO(raw))
txt=''.join(pg.get_text() for pg in t)
print(len(d.pages), len(flds), v, 'FLATTXT' if 'AUSGEFUELLT' in txt else 'NOFLATTXT')
`

test('Formular ausfuellen: Wert auf Datei; Flatten entfernt Feld, Inhalt bleibt', async ({ page }) => {
  test.setTimeout(90_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })

  // Formular-Layer: Feld existiert und ist bedienbar.
  const input = page.getByTestId('form-field-Feld1')
  await expect(input).toBeVisible({ timeout: 20_000 })
  await input.click()
  await input.fill('AUSGEFUELLT')
  await input.blur() // commit erfolgt per blur

  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY_FIELDS, BACKEND, TOKEN])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toMatch(/^1 1 AUSGEFUELLT/)

  // Flatten per echter UI (Dialog in Seiten-Werkzeugen oder Overflow).
  const btn = page.getByTestId('pg-flatten')
  const shown = await btn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
  let opened = false
  if (shown) opened = await btn.click({ timeout: 3_000 }).then(() => true, () => false)
  if (!opened) {
    await page.getByTestId('pages-more').click()
    await page.getByTestId('ctx-pg-flatten').click()
  }
  const runBtn = page.getByTestId('flatten-run')
  if (await runBtn.isVisible().catch(() => false)) await runBtn.click()

  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY_FIELDS, BACKEND, TOKEN])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toMatch(/^1 0 NOFIELD FLATTXT$/)

  // Originaltext des Fixtures darf dem Flatten nicht zum Opfer gefallen sein.
  const { stdout: mark } = await run(py, ['-c',
    `import sys, urllib.request, pymupdf, io\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nd=pymupdf.open('pdf', io.BytesIO(urllib.request.urlopen(req).read()))\nprint('FORMFIX' in ''.join(p.get_text() for p in d))`,
    BACKEND, TOKEN])
  expect(mark.trim()).toBe('True')
})
