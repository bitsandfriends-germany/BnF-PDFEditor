// Nutzerbefund: Thumbnail-Vorschau muss zum Seitenformat passen (nicht ueberbreit/uebergross).
// Fixture: A4 hoch, A4 quer, A3 hoch, A4 hoch mit /Rotate 90. Asserts pro Thumbnail-Canvas:
// (1) Seitenverhaeltnis == rotiertes Seitenverhaeltnis (+/-1.5 %),
// (2) Canvas passt komplett in die Thumbnail-Zelle (Breite UND Hoehe),
// (3) quer/rotiert ist breiter als hoch; A4-hoch hoeher als breit.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-thumb-'))
  file = path.join(dir, 'mixed.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\np=d.new_page(width=595,height=842); p.insert_text((72,120),'T1',fontsize=30)\np=d.new_page(width=842,height=595); p.insert_text((72,120),'T2',fontsize=30)\np=d.new_page(width=842,height=1191); p.insert_text((72,120),'T3',fontsize=30)\np=d.new_page(width=595,height=842); p.insert_text((72,120),'T4',fontsize=30); p.set_rotation(90)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Thumbnails passen sich dem Seitenformat an (Contain, korrektes Aspect)', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })
  await expect(page.getByTestId('thumb-item-0').locator('canvas')).toBeVisible({ timeout: 20_000 })

  const data = await page.evaluate(() => {
    const out: Array<{ i: number; cw: number; ch: number; ww: number; wh: number }> = []
    for (let i = 0; i < 4; i++) {
      const wrap = document.querySelector(`[data-testid="thumb-wrap-${i}"]`) as HTMLElement
      const canvas = document.querySelector(`[data-testid="thumb-item-${i}"] canvas`) as HTMLCanvasElement | null
      if (wrap && canvas) {
        const wr = wrap.getBoundingClientRect()
        const cr = canvas.getBoundingClientRect()
        out.push({ i, cw: cr.width, ch: cr.height, ww: wr.width, wh: wr.height })
      }
    }
    return out
  })
  expect(data.length).toBe(4)

  // Erwarteterotierte Formate: T1 595x842 hoch, T2 842x595 quer, T3 842x1191 hoch, T4 rot90 -> quer.
  const expected = [
    { w: 595, h: 842, landscape: false },
    { w: 842, h: 595, landscape: true },
    { w: 842, h: 1191, landscape: false },
    { w: 842, h: 595, landscape: true }
  ]
  for (const d of data) {
    const e = expected[d.i]!
    const want = e.w / e.h
    const got = d.cw / d.ch
    expect(Math.abs(got - want) / want, `Aspect Seite ${d.i + 1}`).toBeLessThan(0.015)
    expect(d.cw, `Breite Seite ${d.i + 1} in Zelle`).toBeLessThanOrEqual(d.ww + 1)
    expect(d.ch, `Hoehe Seite ${d.i + 1} in Zelle`).toBeLessThanOrEqual(d.wh + 1)
    expect(got > 1, `Format-Seite ${d.i + 1} ${e.landscape ? 'quer' : 'hoch'}`).toBe(e.landscape)
  }
})
