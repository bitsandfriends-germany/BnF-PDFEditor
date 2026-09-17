// R73 Nutzerbefund: "facing pages und auch andere funktionen aus dieser einstellung liefert nur
// die ersten seiten und dann nur noch '…'".
// Ursache: die Navigations-Geometrie (Scroll-Spy = Fokusseite = Render-Fenster) wurde nur fuer die
// Einspalten-Modi berechnet. In den Doppelseiten-Modi blieb die Fokusseite auf Seite 1 stehen, alle
// spaeteren Zeilen blieben Platzhalter.
// Beweis: nach dem Scrollen werden die hinteren Zeilen WIRKLICH gerendert (data-render=1, Canvas mit
// Inhalt) und die aktuelle Seite wandert mit; Nicht-Aenderung: Layout ist rein visuell (Datei-Hash
// unveraendert, Seitenzahl unveraendert).
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

async function fileHash(): Promise<string> {
  const ab = await (await fetch(`${BACKEND}/document/file`, { headers: { 'X-Auth-Token': TOKEN } })).arrayBuffer()
  const tmp = path.join(os.tmpdir(), `face-hash-${Date.now()}.pdf`)
  fs.writeFileSync(tmp, Buffer.from(ab))
  const { stdout } = await run(py, ['-c', 'import sys, hashlib; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())', tmp])
  fs.unlinkSync(tmp)
  return stdout.trim()
}

const scrollToBottom = async (page: import('@playwright/test').Page): Promise<void> => {
  await page.evaluate(() => {
    const col = document.querySelector('[data-testid="facing-column"]') as HTMLElement | null
    const el = (col?.closest('div.overflow-auto') ?? document.querySelector('div.overflow-auto')) as HTMLElement | null
    if (el) el.scrollTop = el.scrollHeight
  })
}

test.describe('R73: Doppelseiten rendern auch hintere Seiten', () => {
  let file: string

  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-facing-'))
    file = path.join(dir, 'six.pdf')
    await run(py, ['-c', `import sys, fitz
d=fitz.open()
for i in range(1, 7):
    p=d.new_page(width=595, height=842)
    p.insert_text((60, 80), f'SEITE {i}', fontsize=28)
    p.draw_rect(fitz.Rect(60, 120, 300, 300), color=(0,0,0), fill=(0,0,0))
d.save(sys.argv[1]); d.close()`, file])
  })

  const openFacing = async (page: import('@playwright/test').Page, mode: string): Promise<void> => {
    await installBridgeStub(page, BACKEND, TOKEN)
    await setDialogPaths(page, file)
    await page.goto('http://localhost:5199/')
    await page.getByTestId('tb-open').click()
    await expect(page.getByTestId('page-count')).toContainText('6', { timeout: 30_000 })
    await page.getByTestId('layout-select').selectOption(mode)
    await expect(page.getByTestId('facing-column')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('facing-slot-1')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(500)
  }

  test('facing: nach dem Scrollen sind die hinteren Zeilen gerendert, Seite wandert mit', async ({ page }) => {
    test.setTimeout(120_000)
    await openFacing(page, 'facing')
    const hashBefore = await fileHash()

    // Startlage: erste Zeilen gerendert, spaetere sind Platzhalter ("…").
    await expect(page.getByTestId('facing-slot-1')).toHaveAttribute('data-render', '1')
    await expect(page.getByTestId('facing-slot-6')).toHaveAttribute('data-render', '0')
    await expect(page.getByTestId('facing-slot-6')).toContainText('…')

    await scrollToBottom(page)

    // Kern des Fixes: die letzte Zeile wird wirklich gerendert (vorher blieb sie ewig Platzhalter).
    await expect.poll(async () => page.getByTestId('facing-slot-6').getAttribute('data-render'), {
      timeout: 30_000,
      message: 'letzte Zeile gerendert'
    }).toBe('1')
    // Fokusseite ist mitgewandert (Scroll-Spy arbeitet in Doppelseiten jetzt).
    await expect.poll(async () => Number(await page.getByTestId('tb-page-input').inputValue()), {
      timeout: 20_000,
      message: 'aktuelle Seite folgt dem Scrollen'
    }).toBeGreaterThanOrEqual(5)

    // Und es ist ECHTER Inhalt: Canvas vorhanden und nicht leer (Zeichnen ist asynchron).
    const paintedCount = async (): Promise<number> => await page.evaluate(() => {
      const slot = document.querySelector('[data-testid="facing-slot-6"]') as HTMLElement | null
      const cv = slot?.querySelector('canvas') as HTMLCanvasElement | null
      if (!cv) return -1
      const ctx = cv.getContext('2d') as CanvasRenderingContext2D
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data
      let dark = 0
      for (let i = 0; i < img.length; i += 4 * 7) if (img[i] + img[i + 1] + img[i + 2] < 200) dark++
      return dark
    })
    await expect.poll(paintedCount, { timeout: 25_000, message: 'Seite 6 hat gezeichneten Inhalt' }).toBeGreaterThan(50)

    // Nicht-Aenderung: Layout-Wechsel/Scrollen fasst die Datei nicht an.
    expect(await fileHash(), 'Datei unveraendert').toBe(hashBefore)
    await expect(page.getByTestId('page-count')).toContainText('6')
  })

  test('facing-cover: Titelblatt allein, danach Paare — auch hinten gerendert', async ({ page }) => {
    test.setTimeout(120_000)
    await openFacing(page, 'facing-cover')

    // Zeile 1 = nur Seite 1 (Cover), Zeile 2 = Seiten 2+3.
    const row1 = page.getByTestId('facing-row-1')
    await expect(row1.getByTestId('facing-slot-1')).toBeVisible()
    await expect(row1.getByTestId('facing-slot-2')).toHaveCount(0)
    await expect(page.getByTestId('facing-row-2').getByTestId('facing-slot-2')).toBeVisible()
    await expect(page.getByTestId('facing-row-2').getByTestId('facing-slot-3')).toBeVisible()

    await scrollToBottom(page)
    await expect.poll(async () => page.getByTestId('facing-slot-6').getAttribute('data-render'), {
      timeout: 30_000,
      message: 'letzte Seite gerendert (facing-cover)'
    }).toBe('1')
    // Seite 6 liegt allein in der letzten Zeile.
    await expect(page.getByTestId('facing-row-6').getByTestId('facing-slot-6')).toBeVisible()
    await expect(page.getByTestId('facing-row-6').getByTestId('facing-slot-5')).toHaveCount(0)
  })

  test('Seitenzahl-Sprung funktioniert in Doppelseiten (Zeilen-Offset statt Seiten-Offset)', async ({ page }) => {
    test.setTimeout(120_000)
    await openFacing(page, 'facing')
    await page.getByTestId('tb-page-input').fill('5')
    await page.getByTestId('tb-page-input').press('Enter')
    await expect.poll(async () => page.getByTestId('facing-slot-5').getAttribute('data-render'), {
      timeout: 30_000,
      message: 'Sprung auf Seite 5 rendert die Zeile'
    }).toBe('1')
    await expect(page.getByTestId('facing-slot-5')).toBeVisible()
  })
})
