// "Speichern unter" + Ueberschreib-Warnung (Nutzerwuensche Runde 51):
// SaveAs schreibt ins NEUE Ziel und laesst das Original unangetastet; Ziel existiert schon
// -> zwingende Bestaetigung (Abbruch veraendert nichts, Bestaetigen ueberschreibt).
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { installBridgeStub, setDialogPaths, setSavePath } from './bridge'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

let file: string
let target: string

test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-saveas-'))
  file = path.join(dir, 'original.pdf')
  target = path.join(dir, 'arbeit.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\np=d.new_page()\np.insert_text((72,120),'ORIG',fontsize=24)\nd.save(sys.argv[1])\n`, file])
})

const PY = `
import sys, pymupdf, os
out=[]
for p in sys.argv[1:]:
    if not os.path.exists(p): out.append(p.split('/')[-1]+':FEHLT'); continue
    d=pymupdf.open(p)
    out.append(p.split('/')[-1]+':'+d[0].get_text().replace(chr(10),'').replace(' ',''))
print(' '.join(out))
`

test('SaveAs: Original bleibt heil; Ueberschreiben nur nach Bestaetigung', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })

  // Erste Rotation -> SaveAs in neues Ziel.
  const canvas = page.locator('canvas[aria-label="Seite 1"]')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  await setSavePath(page, target)
  await page.keyboard.press('Control+Shift+s')
  await page.waitForTimeout(1200)
  await expect.poll(async () => (await run(py, ['-c', PY, file, target])).stdout.trim(), { timeout: 15_000, intervals: [800, 1500] })
    .toContain('original.pdf:ORIG arbeit.pdf:ORIG')
  const targetBytes1 = fs.statSync(target).size

  // Aenderung (Rotation) + SaveAs auf das EXISTIERENDE Ziel -> Bestaetigungsdialog erscheint.
  const thumb = page.locator('[data-testid^="thumb-item-"]').first()
  await thumb.click()
  await thumb.click({ button: 'right' })
  await page.getByTestId('ctx-group-grp.pdf').click() // R55: Flyout oeffnen
  const rot = page.getByTestId('ctx-pg-rot-right')
  await rot.click()
  await page.waitForTimeout(1200)
  await page.keyboard.press('Control+Shift+s')
  await expect(page.getByTestId('confirm-ok')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('confirm-cancel').click()
  await page.waitForTimeout(600)
  expect(fs.statSync(target).size).toBe(targetBytes1) // Abbruch: Ziel unveraendert

  // Nochmal: bestaetigen -> Ziel wird ueberschrieben (Rotation drin, Original unveraendert).
  await page.keyboard.press('Control+Shift+s')
  await expect(page.getByTestId('confirm-ok')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('confirm-ok').click()
  await expect.poll(async () => {
    const s = (await run(py, ['-c', PY, file, target])).stdout.trim()
    return s
  }, { timeout: 15_000, intervals: [800, 1500] }).toContain('original.pdf:ORIG arbeit.pdf:')
  expect(fs.statSync(target).size).not.toBe(targetBytes1)
})
