// §3-Zeile "text stamp ... at the expected coordinates within a tolerance of 1 pt" durch die
// ECHTE UI: Werkzeug scharf stellen, canvas-feste Stelle (CSS 100/150 relativ zur Seite) klicken,
// Text bestaetigen. Assert (pikepdf auf GET /document/file): Tm-Baseline des Stempels exakt an
// der umgerechneten PDF-Position (x, 842-y) innerhalb 1.5pt; Stempel NICHT auf Seite 2;
// MARKs unveraendert; Seitenzahl 2.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-stamp-'))
  file = path.join(dir, 'two.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in (1,2):\n p=d.new_page(width=595,height=842)\n p.insert_text((72,120),'MARK-T%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Textstempel landet auf dem angeklickten Punkt (±1 pt), nur auf Seite 1', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })
  await expect.poll(async () => page.locator('[data-testid^="page-slot-"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)

  const btn = page.getByTestId('pg-stamp')
  const shown = await btn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
  let opened = false
  if (shown) {
    // Die Toolbar kann nach Thumbnail-Mount neu vermessen und die Gruppe ins Overflow
    // verschieben — Klick kurz halten und im Fehlerfall den Overflow-Pfad nehmen.
    opened = await btn.click({ timeout: 3_000 }).then(() => true, () => false)
  }
  if (!opened) {
    await page.getByTestId('pages-more').click()
    await page.getByTestId('ctx-pg-stamp').click()
  }

  // Seite-1-Oberkante voll sichtbar machen (sonst liegt der Zielpunkt unter dem TopBar).
  await page.evaluate(() => {
    const col = document.querySelector('[data-testid="page-column"]') as HTMLElement
    ;(col.closest('div.overflow-auto') as HTMLElement).scrollTop = 0
  })
  await page.waitForTimeout(400)
  // Klick 100/150 CSS-px relativ zur Canvas-Oberkante von Seite 1.
  const canvas = page.locator('canvas[aria-label="Seite 1"]')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  const cssW = await canvas.evaluate((el) => (el as HTMLCanvasElement).clientWidth)
  page.on('console', (m) => { if (m.text().startsWith('PD:')) console.log('  >', m.text()) })
  await page.evaluate(() => {
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement
      console.log('PD:', t.tagName + '.' + String(t.className).slice(0, 50))
    }, true)
  })
  // Echte Presse-Geste (down, minimal bewegen, up) — der Overlay-Handler arbeitet auf Pointer-Events.
  console.log('  > BOX', JSON.stringify(box))
  await canvas.click({ position: { x: 100, y: 250 }, force: true })

  await expect(page.getByTestId('stamp-text')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('stamp-text').fill('STEMPELPUNKT')
  await page.getByTestId('stamp-run').click()

  // Erwartete PDF-Position: fitz-Koordinaten (y von oben) = CSS / (cssW/595).
  const scale = cssW / 595
  const xExp = 100 / scale
  const yExp = 250 / scale
  await page.evaluate(() => { ;(window as unknown as { __errors?: string[] }).__errors = []; window.addEventListener('error', (e) => { (window as unknown as { __errors: string[] }).__errors.push(String(e.message)) }) })

  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c',
      `import sys, urllib.request, pikepdf, io\nfrom pikepdf import Array, String\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nraw=urllib.request.urlopen(req).read()\nd=pikepdf.open(io.BytesIO(raw))\ndef tms(pg):\n    out=[]\n    for ops,op in pikepdf.parse_content_stream(pg):\n        if str(op)=='Tm' and len(ops)==6:\n            try: out.append((float(ops[4]), float(ops[5])))\n            except Exception: pass\n    return out\ndef has_stamp(pg):\n    s=''\n    def eat(o):\n        nonlocal s\n        if isinstance(o,String): s+=bytes(o).decode('latin-1')+'|'\n        elif isinstance(o,Array):\n            for x in o: eat(x)\n    for ops,op in pikepdf.parse_content_stream(pg):\n        for o in ops: eat(o)\n    return s\np1=has_stamp(d.pages[0]); p2=has_stamp(d.pages[1])\nhits=[(round(e,2),round(f,2)) for (e,f) in tms(d.pages[0]) if 'STEMPELPUNKT' in p1]\nprint(len(d.pages), 'STEMPELPUNKT' in p1, 'STEMPELPUNKT' in p2, 'MARK-T1' in p1, 'MARK-T2' in p2, hits[:4])`,
      BACKEND, TOKEN])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toContain('True False True True')

  // Koordinaten-Beweis: eines der Tm-Paare liegt auf der erwarteten Baseline (x, 842-y) ±1.5pt.
  const { stdout } = await run(py, ['-c',
    `import sys, urllib.request, pikepdf, io\nfrom pikepdf import Array, String\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nraw=urllib.request.urlopen(req).read()\nd=pikepdf.open(io.BytesIO(raw))\ntms=[]\nfor ops,op in pikepdf.parse_content_stream(d.pages[0]):\n    if str(op)=='Tm' and len(ops)==6:\n        try: tms.append((float(ops[4]), float(ops[5])))\n        except Exception: pass\nxexp, fexp = float(sys.argv[3]), 842-float(sys.argv[4])\nbest=min(tms, key=lambda t: abs(t[0]-xexp)+abs(t[1]-fexp))\nprint(round(abs(best[0]-xexp),3), round(abs(best[1]-fexp),3))`,
    BACKEND, TOKEN, String(xExp), String(yExp)])
  const [dx, dy] = stdout.trim().split(' ').map(Number)
  expect(dx, 'Stempel-x innerhalb 1 pt').toBeLessThanOrEqual(1)
  expect(dy, 'Stempel-y (Baseline, PDF-orientierung) innerhalb 1 pt').toBeLessThanOrEqual(1)
})
