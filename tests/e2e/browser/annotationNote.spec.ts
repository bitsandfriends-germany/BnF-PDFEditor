// §3-Zeile "Annotations" durch die ECHTE UI: Text-Notiz-Werkzeug bewaffnen, Region auf
// Seite 1 ziehen, Notiztext + Autor 'E2E-AUTOR' eintragen, anwenden. Assert (pikepdf auf
// GET /document/file): genau eine Annotation, /Subtype /Text auf Seite 1, /Rect-Linkskante ==
// Region-x und /Rect-Oberkante (PDF-Orientierung) == Region-Unterkante je ±1 pt (Notiz-Anker
// unten-links der gezogenen Region), /T == Autor, /Contents == Notiztext; MARK-Texte bleiben
// extrahierbar, Seite 2 annotfrei. (Highlight-Rects snappen auf Glyph-Quads und sind per
// Definition nicht drag-exakt; Text-Notizen sind der scharfe Rechteck-Kontrakt.)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-ann-'))
  file = path.join(dir, 'two.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in (1,2):\n p=d.new_page(width=595,height=842)\n p.insert_text((72,120),'MARK-H%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Text-Notiz per Werkzeug+Drag: Subtype/Seite/Rect-Anker/Autor/Contents exakt', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })
  await expect.poll(async () => page.locator('[data-testid^="page-slot-"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  await page.evaluate(() => {
    const col = document.querySelector('[data-testid="page-column"]') as HTMLElement
    ;(col.closest('div.overflow-auto') as HTMLElement).scrollTop = 0
  })
  await page.waitForTimeout(300)

  // Annotationen gehoeren bewusst NICHT zur Seiten-Werkzeugleiste; echter Nutzer-Einstieg
  // ist das Annotationen-Panel (Typ waehlen, platzieren). ann-new-type Default: Highlight.
  await page.getByTestId('sidebar-tab-annotations').click()
  await page.getByTestId('ann-new-type').selectOption('Text')
  await page.getByTestId('ann-place').click()

  const canvas = page.locator('canvas[aria-label="Seite 1"]')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  const cssW = await canvas.evaluate((el) => (el as HTMLCanvasElement).clientWidth)
  await page.mouse.move(box!.x + 80, box!.y + 200)
  await page.mouse.down()
  await page.mouse.move(box!.x + 300, box!.y + 260, { steps: 8 })
  await page.mouse.up()

  await expect(page.getByTestId('ann-add-apply')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('ann-add-text').fill('E2E-NOTIZ')
  await page.getByTestId('ann-add-author').fill('E2E-AUTOR')
  await page.getByTestId('ann-add-apply').click()

  const s = cssW / 595
  const PY = `
import sys, urllib.request, pikepdf, pymupdf, io
req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})
raw=urllib.request.urlopen(req).read()
d=pikepdf.open(io.BytesIO(raw))
raw1=list(d.pages[0].get('/Annots') or [])
raw2=list(d.pages[1].get('/Annots') or [])
# /Popup ist die korrekt zugeordnete Popup-Haelfte einer Text-Notiz, keine eigene Annotation.
a1=[x for x in raw1 if str(x['/Subtype'])!='/Popup']
a2=[x for x in raw2 if str(x['/Subtype'])!='/Popup']
assert any(str(x['/Subtype'])=='/Popup' for x in raw1), 'Popup-Kind fehlt'
if len(a1)==0:
    print('WAIT', len(d.pages), 0, 0, 'NONE'); raise SystemExit
ann=a1[0]
r=[round(float(v),2) for v in ann['/Rect']]
info=ann.get('/T')
import pymupdf as fz
txt=''.join(pg.get_text() for pg in fz.open('pdf', io.BytesIO(raw)))
print('MARKS' if ('MARK-H1' in txt and 'MARK-H2' in txt) else 'NOMARKS', end=' ')
c=ann.get('/Contents')
print(len(d.pages), len(a1), len(a2), str(ann['/Subtype']), r[0], r[3], str(info) if info is not None else 'NONE', str(c) if c is not None else 'NOCONTENTS')
`
  let last = ''
  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY, BACKEND, TOKEN])
    last = stdout.trim()
    return last
  }, { timeout: 30_000, intervals: [1000, 2000] }).toMatch(/^MARKS 2 1 0 \/Text /)
  const nums = last.split(' ')
  const rx0 = Number(nums[5])
  const ry1 = Number(nums[6])
  const author = nums[7]
  const contents = nums.slice(8).join(' ')
  // Notiz-Anker = unten-links der gezogenen Region: linke Rect-Kante == Region-x, obere
  // Rect-Kante (PDF-Orientierung) == PDF-y der Regions-Unterkante.
  expect(Math.abs(rx0 - 80 / s), 'Rect-Linkskante == Region-x (±1 pt)').toBeLessThanOrEqual(1)
  expect(Math.abs(ry1 - (842 - 260 / s)), 'Rect-Oberkante == Region-Unterkante (±1 pt)').toBeLessThanOrEqual(1)
  expect(author).toBe('E2E-AUTOR')
  expect(contents).toContain('E2E-NOTIZ')
})
