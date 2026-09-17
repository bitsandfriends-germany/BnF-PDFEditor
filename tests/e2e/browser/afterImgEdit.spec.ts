// R56 Regression: NACH Bild-Edit+Save muss Signaturfeld-Platzierung funktionieren.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-aie-'))
  file = path.join(dir, 'doc.pdf')
  const jpg = path.join(dir, 'p.jpg')
  await run('python3', ['-c', `import sys
from PIL import Image
Image.new('RGB',(240,160),(30,120,200)).save(sys.argv[1])`, jpg])
  await run(py, ['-c', `import sys, pymupdf
d = pymupdf.open(); p = d.new_page()
p.insert_image(pymupdf.Rect(80, 200, 515, 640), filename=sys.argv[2])
d.save(sys.argv[1])`, file, jpg])
})


async function openP12Section(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click() // R60: Abschnitte sind Standard eingeklappt
  await expect(page.getByTestId('cert-choose')).toBeVisible({ timeout: 4_000 })
}

test('Bild-editieren + Save -> danach Signaturfeld platzieren (Beweis: info + Overlay-Rect)', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })

  const canvas = page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first()
  const b = (await canvas.boundingBox())!
  // 1) Bild doppelklicken und bewegen
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2)
  await expect(page.getByTestId('imgobj-frame-1')).toBeVisible({ timeout: 8_000 })
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(600)

  // 2) Signaturfeld bewaffnen -> Region ziehen
  await openP12Section(page)
  await page.getByTestId('cert-field-arm').click()
  const b2 = (await canvas.boundingBox())!
  const y1 = Math.max(b2.y + 40, 20)
  await page.mouse.move(b2.x + 150, y1 + 60)
  await page.mouse.down()
  await page.mouse.move(b2.x + 380, y1 + 160, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByTestId('cert-field-info'), 'Platzierung nach Bild-Edit kaputt').toContainText(/1/, { timeout: 4_000 })
})
