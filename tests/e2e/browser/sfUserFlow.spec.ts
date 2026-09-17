// R58 Nutzerreport: Feld "platziert sich selber"; danach nicht markierbar/verschiebbar.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-uf-'))
  file = path.join(dir, 'doc.pdf')
  const jpg = path.join(dir, 'p.jpg')
  await run('python3', ['-c', `import sys
from PIL import Image
Image.new('RGB',(300,200),(90,140,90)).save(sys.argv[1])`, jpg])
  await run(py, ['-c', `import sys, pymupdf
d=pymupdf.open(); p=d.new_page()
p.insert_image(pymupdf.Rect(60,500,540,780), filename=sys.argv[2])
d.save(sys.argv[1])`, file, jpg])
})

const sf = (page: import('@playwright/test').Page) => page.getByTestId('sigfield-1')
const rectStyle = async (page: import('@playwright/test').Page): Promise<string | null> => (await sf(page).count()) > 0 ? await sf(page).getAttribute('style') : null


async function openP12Section(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click() // R60: Abschnitte sind Standard eingeklappt
  await expect(page.getByTestId('cert-choose')).toBeVisible({ timeout: 4_000 })
}

test('Bewaffnen -> Ziehen -> danach greifen und verschieben', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  const canvas = page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first()
  // Sichtbaren Ausschnitt der Seitewaehlen: Canvas kann ueber den Rand gescrollt sein.
  const b = (await canvas.boundingBox())!
  const vy0 = Math.max(0, b.y) + 20
  const vh = Math.max(0, Math.min(b.y + b.height, 700)) - vy0
  console.log('canvas', JSON.stringify(b), 'vy0', vy0, 'vh', vh)

  await openP12Section(page)
  await page.getByTestId('cert-field-arm').click()
  console.log('A1 overlay unmittelbar nach ARM:', await rectStyle(page))

  // A) EINZELKLICK (kein Ziehen) — darf kein Feld setzen
  await page.mouse.click(b.x + 300, vy0 + vh - 40)
  console.log('A2 nach Einzelklick, info:', await page.getByTestId('cert-field-info').count())

  // B) Region ziehen -> Feld entsteht
  await page.evaluate(() => {
    ;(window as unknown as { __ev: string[] }).__ev = []
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      document.addEventListener(t, (e) => {
        const el = e.target as HTMLElement
        ;(window as unknown as { __ev: string[] }).__ev.push(t + ':' + (el.getAttribute('data-testid') ?? el.tagName + '.' + (el.className ?? '').toString().slice(0, 26)) + (t === 'pointerdown' ? '[data-tool=' + (el.closest('[data-tool]')?.getAttribute('data-tool') ?? '?') + ']' : ''))
      }, true)
    }
  })
  await page.mouse.move(b.x + 150, 520)
  await page.mouse.down()
  await page.mouse.move(b.x + 350, 610, { steps: 6 })
  await page.mouse.up()
  console.log('B-EVENTS:', await page.evaluate(() => (window as unknown as { __ev: string[] }).__ev.join(' | ')))
  const bNow = (await canvas.boundingBox())!
  console.log('B canvas-now', JSON.stringify(bNow))
  await expect(page.getByTestId('cert-field-info')).toContainText(/1/, { timeout: 4_000 })
  const before = await rectStyle(page)
  console.log('B1 nach Region:', before)

  // C) Feld anklicken + ziehen (markieren & verschieben)
  const f = (await sf(page).boundingBox())!
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2)
  await page.mouse.down()
  await page.mouse.move(f.x + f.width / 2 + 70, f.y + f.height / 2 + 40, { steps: 6 })
  await page.mouse.up()
  const after = await rectStyle(page)
  console.log('C1 nach Drag:', after)
  expect(after, 'Feld laesst sich nach dem Platzieren NICHT verschieben').not.toBe(before)
})
