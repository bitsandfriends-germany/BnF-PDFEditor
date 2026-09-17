// Nutzerfluss Runde 50: Grafik per Drop -> Vorschau -> freie Region -> Einbetten -> Save.
// Beweis auf der PLATTENDATEI (pymupdf): Bild auf Seite 1, Seite 2 bildfrei, MARKs heil.
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
let img: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-place-'))
  file = path.join(dir, 'doc.pdf')
  img = path.join(dir, 'graphic.png')
  await run(py, ['-c',
    `import sys, struct, zlib, base64, pymupdf\nd=pymupdf.open()\nfor i in (1,2):\n p=d.new_page()\n p.insert_text((72,120),'MARK-P%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()\ndef png(w,h,col):\n raw=b''.join(b'\\x00'+bytes(col)*w for _ in range(h))\n def ch(t,x):\n  c=t+x; return struct.pack('>I',len(x))+c+struct.pack('>I',zlib.crc32(c))\n return b'\\x89PNG\\r\\n\\x1a\\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')\ndata=png(20,20,(220,30,30))\nopen(sys.argv[2],'wb').write(data)\nprint(base64.b64encode(data).decode())`,
    file, img])
})

test('Drop -> Vorschau -> Region -> Einbetten -> Save: Bild nur auf Seite 1', async ({ page }) => {
  test.setTimeout(60_000)
  const b64 = fs.readFileSync(img).toString('base64')
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setStampImage(page, img, b64)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })
  // Die Fest-geschriebene Bild-BBox gilt fuer fitWidth-Skalierung — Default ist R60 fitPage.
  await page.getByTestId('tb-zoom-select').selectOption('fitWidth')
  await expect(page.locator('[data-testid^="page-slot-"]').first()).toBeVisible({ timeout: 20_000 })

  // Drop eines Grafik-Files aufs Fenster (pathForFile/readImageAsBase64 sind gestubbted).
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1])], 'graphic.png', { type: 'image/png' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  const bar = page.getByTestId('placement-bar')
  await expect(bar).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('place-preview')).toBeVisible()

  // Region auf Seite 1 ziehen (unterer linker Bereich).
  const canvas = page.locator('canvas[aria-label="Seite 1"]')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas box missing')
  // R60: Default ist fitPage (kleinere Seite) — Region relativ zur Canvas-Box.
  await page.mouse.move(box.x + Math.min(60, box.width * 0.2), box.y + Math.min(200, box.height * 0.35))
  await page.mouse.down()
  await page.mouse.move(box.x + Math.min(180, box.width * 0.55), box.y + Math.min(300, box.height * 0.55), { steps: 8 })
  await page.mouse.up()

  await expect(page.getByTestId('place-status')).toContainText('Page 1', { timeout: 5_000 })
  await expect(page.getByTestId('place-overlay-1')).toBeVisible()
  await page.getByTestId('place-apply').click()
  await expect(bar).toBeHidden({ timeout: 15_000 })

  await page.keyboard.press('Control+s')
  const PY = `
import sys, pymupdf
d=pymupdf.open(sys.argv[1])
# Gezeichnete Bilder = Eintrag in get_image_info(); gezehlte XObjects in page2-Ressourcen
# koennen von MuPDFs Ressourcen-Sharing stammen und sind kein placement-Beweis.
i1=len(d[0].get_image_info()); i2=len(d[1].get_image_info())
r1=[tuple(round(v) for v in b['bbox']) for b in d[0].get_image_info()]
t1=d[0].get_text(); t2=d[1].get_text()
print('I1=%d%s I2=%d MARKS=%s' % (i1, r1, i2, 'OK' if ('MARK-P1' in t1 and 'MARK-P2' in t2) else 'MISSING'))
`
  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY, file])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toBe('I1=1[(39, 130, 117, 196)] I2=0 MARKS=OK')
})
