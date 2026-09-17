// §4 letzter Punkt: "Facing-page and single-page modes follow the same rules; only the column
// arrangement changes." — Mischgrößen-Fixture bei 800px: after Layout-Wechsel continuous->facing
// bleibt dieselbe Fit-Width-Skala (Zellbreite von Seite 1 identisch), kein horizontaler
// Scrollbalken, Zell-Container == Canvas-Box, Reihenabstaende gleich (16-24), Label pro Seite da.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-face-'))
  file = path.join(dir, 'mixed.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nd.new_page(width=595,height=842)\nd.new_page(width=842,height=595)\nd.new_page(width=842,height=1191)\ne=d.new_page(width=595,height=842); e.set_rotation(90)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('continuous -> facing: Regel-Paritaet, kein H-Scrollbar, gleiche Luecken, Labels', async ({ browser }) => {
  test.setTimeout(60_000)
  const ctx = await browser.newContext({ viewport: { width: 800, height: 900 } })
  const page = await ctx.newPage()
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })
  await expect.poll(async () => page.locator('[data-testid^="page-slot-"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)

  const wSingle = await page.locator('canvas[aria-label="Seite 1"]').evaluate((el) => (el as HTMLCanvasElement).clientWidth)

  await page.getByTestId('layout-select').selectOption('facing')
  await expect(page.getByTestId('facing-column')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => page.locator('[data-testid^="facing-slot-"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)

  const m = await page.evaluate(() => {
    const col = document.querySelector('[data-testid="facing-column"]') as HTMLElement
    const scroll = col.closest('div.overflow-auto') as HTMLElement
    const rows = Array.from(col.querySelectorAll('[data-testid^="facing-row-"]')) as HTMLElement[]
    const gaps: number[] = []
    for (let i = 1; i < rows.length; i++) gaps.push(Math.round((rows[i]!.offsetTop - (rows[i - 1]!.offsetTop + rows[i - 1]!.offsetHeight)) * 10) / 10)
    const cellChecks = Array.from(col.querySelectorAll('[data-testid^="facing-slot-"]')).map((s) => {
      const el = s as HTMLElement
      const n = parseInt(el.getAttribute('data-testid')!.replace('facing-slot-', ''), 10)
      const cv = el.querySelector('canvas') as HTMLCanvasElement | null
      if (!cv) return { n, ok: true }
      return { n, ok: Math.abs(el.offsetWidth - cv.clientWidth) <= 1 && Math.abs(el.offsetHeight - cv.clientHeight) <= 1 }
    })
    const w1 = (document.querySelector('[data-testid="facing-slot-1"] canvas') as HTMLCanvasElement | null)?.clientWidth ?? -1
    const label1 = document.querySelector('[data-testid="facing-label-1"]')?.textContent ?? ''
    return { hScroll: scroll.scrollWidth > scroll.clientWidth + 1, gaps, cellChecks, w1, label1 }
  })

  expect(m.hScroll, 'facing: kein horizontaler Scrollbalken').toBe(false)
  // Paritaet der REGEL (nicht der Zahl): facing fitet gegen halbe Breite -> exakt halbe Skala.
  expect(Math.abs(m.w1 - wSingle / 2), 'Paritaet: facing-Skala == continuous-Skala / 2 (Doppelzelle)').toBeLessThanOrEqual(1)
  expect(m.gaps.length).toBeGreaterThanOrEqual(1)
  for (const g of m.gaps) { expect(g).toBeGreaterThanOrEqual(16); expect(g).toBeLessThanOrEqual(24) }
  expect(new Set(m.gaps).size, 'Reihenabstaende gleich').toBe(1)
  expect(m.cellChecks.every((c) => c.ok), 'Zell-Container == Canvas-Box').toBe(true)
  expect(m.label1, 'Seitenlabel unter der Seite').toContain('1')
  await ctx.close()
})
