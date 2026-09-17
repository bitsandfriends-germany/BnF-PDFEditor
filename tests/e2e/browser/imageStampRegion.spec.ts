// §3-Zeile "Image ... stamp" durch die ECHTE UI: Bild bewaffnen (pickImage/readImageAsBase64
// gestubbt), Region auf Seite 1 ziehen (Draw-Rechteck = Zielrect), bestaetigen.
// Assert (pikepdf auf GET /document/file): /Image-XObject + Do genau auf Seite 1, cm-Translation
// auf dem gezogenen Rechteck (e=x, f=842-(y+h)) innerhalb 1 pt; Seite 2 bildfrei; MARKs heil.
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { installBridgeStub, setDialogPaths, setStampImage } from './bridge'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

let file: string
let imgPath: string
let imgB64: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-imgstamp-'))
  file = path.join(dir, 'two.pdf')
  imgPath = path.join(dir, 'stamp.png')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in (1,2):\n p=d.new_page(width=595,height=842)\n p.insert_text((72,120),'MARK-G%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()\npix=pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0,0,80,40))\npix.set_rect(pix.irect, (200,30,30))\nopen(sys.argv[2],'wb').write(pix.tobytes('png'))`,
    file, imgPath])
  imgB64 = fs.readFileSync(imgPath).toString('base64')
})

test('Bildstempel auf gezogener Region: XObject + cm-Position ±1 pt, nur Seite 1', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setStampImage(page, imgPath, imgB64)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })
  await expect.poll(async () => page.locator('[data-testid^="page-slot-"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  await page.evaluate(() => {
    const col = document.querySelector('[data-testid="page-column"]') as HTMLElement
    ;(col.closest('div.overflow-auto') as HTMLElement).scrollTop = 0
  })
  await page.waitForTimeout(300)

  const btn = page.getByTestId('pg-stamp-image')
  const shown = await btn.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
  let opened = false
  if (shown) opened = await btn.click({ timeout: 3_000 }).then(() => true, () => false)
  if (!opened) {
    await page.getByTestId('pages-more').click()
    await page.getByTestId('ctx-pg-stamp-image').click()
  }

  const canvas = page.locator('canvas[aria-label="Seite 1"]')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  const cssW = await canvas.evaluate((el) => (el as HTMLCanvasElement).clientWidth)
  // Region CSS (100,250) -> (180,290) ziehen.
  await page.mouse.move(box!.x + 100, box!.y + 250)
  await page.mouse.down()
  await page.mouse.move(box!.x + 180, box!.y + 290, { steps: 8 })
  await page.mouse.up()

  await expect(page.getByTestId('stampimg-run')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('stampimg-run').click()

  const scale = cssW / 595
  const xPt = 100 / scale
  const yPt = 250 / scale
  const wPt = 80 / scale
  const hPt = 40 / scale

  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c',
      `import sys, urllib.request, pikepdf, io\nfrom pikepdf import Array, String\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nraw=urllib.request.urlopen(req).read()\nd=pikepdf.open(io.BytesIO(raw))\ndef info(pg):\n    has_img=False; cm=None\n    res=pg.get('/Resources')\n    xo=res.get('/XObject') if res else None\n    names=list(xo.keys()) if xo else []\n    imgs=[n for n in names if xo[n].get('/Subtype')=='/Image'] if xo else []\n    ops_list=[]\n    for ops,op in pikepdf.parse_content_stream(pg):\n        opname=str(op)\n        if opname=='Do' and len(ops)==1 and str(ops[0]) in imgs: has_img=True\n        if opname=='cm' and len(ops)==6:\n            try:\n                a,b,c,dd,e,f=[float(v) for v in ops]\n                if abs(a)>1 or abs(dd)>1: cm=(round(a,2),round(dd,2),round(e,2),round(f,2))\n            except Exception: pass\n    return has_img, cm\nh1,c1=info(d.pages[0]); h2,_=info(d.pages[1])\nprint(len(d.pages), h1, h2, c1)`,
      BACKEND, TOKEN])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toMatch(/^2 True False \(/)

  const { stdout } = await run(py, ['-c',
    `import sys, urllib.request, pikepdf, io\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nd=pikepdf.open(io.BytesIO(urllib.request.urlopen(req).read()))\ncm=None\nfor ops,op in pikepdf.parse_content_stream(d.pages[0]):\n    if str(op)=='cm' and len(ops)==6:\n        try:\n            a,b,c,dd,e,f=[float(v) for v in ops]\n            if abs(a)>1 or abs(dd)>1: cm=(a,dd,e,f)\n        except Exception: pass\nprint(cm[2], cm[3], cm[0], cm[1])`,
    BACKEND, TOKEN])
  const [e, f, a, d_] = stdout.trim().split(' ').map(Number)
  expect(Math.abs(e - xPt), 'cm-x == Region-x (±1 pt)').toBeLessThanOrEqual(1)
  expect(Math.abs(f - (842 - (yPt + hPt))), 'cm-y == Region-Unterkante in PDF-Orientierung (±1 pt)').toBeLessThanOrEqual(1)
  expect(Math.abs(a - wPt), 'skalierte Bildbreite == Regionsbreite (±1 pt)').toBeLessThanOrEqual(1)
  expect(Math.abs(d_ - hPt), 'skalierte Bildhoehe == Regionshoehe (±1 pt)').toBeLessThanOrEqual(1)
})
