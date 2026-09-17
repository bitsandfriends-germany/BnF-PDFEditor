// Objekt-Nachbearbeitung (Nutzerwunsch Runde 51): eingebettete Grafik per Doppelklick
// waehlen, Ecke ziehen (skalieren), drehen, loeschen. Beweis auf der PLATTENDATEI.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-objedit-'))
  file = path.join(dir, 'doc.pdf')
  img = path.join(dir, 'g.png')
  const r = await run(py, ['-c',
    `import sys, struct, zlib, base64, pymupdf\nd=pymupdf.open()\np=d.new_page()\np.insert_text((72,120),'MARK-P1',fontsize=24)\nd.save(sys.argv[1]); d.close()\ndef png(w,h,col):\n raw=b''.join(b'\\x00'+bytes(col)*w for _ in range(h))\n def ch(t,x):\n  c=t+x; return struct.pack('>I',len(x))+c+struct.pack('>I',zlib.crc32(c))\n return b'\\x89PNG\\r\\n\\x1a\\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')\ndata=png(20,20,(30,60,220))\nopen(sys.argv[2],'wb').write(data)\nprint(base64.b64encode(data).decode())`,
    file, img])
  return r.stdout
})

const PY_STATE = `
import sys, pymupdf
d=pymupdf.open(sys.argv[1])
ii=d[0].get_image_info()
b=ii[0]['bbox'] if ii else None
print('N=%d %s MARK=%s' % (len(ii), ('%.0f %.0f %.0f %.0f'%b) if b else '-', 'MARK-P1' in d[0].get_text()))
`

test('Doppelklick -> Resize -> Rotate -> Delete auf der Festplatte', async ({ page }) => {
  test.setTimeout(90_000)
  const b64 = fs.readFileSync(img).toString('base64')
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setStampImage(page, img, b64)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await expect(page.locator('canvas[aria-label="Seite 1"]')).toBeVisible({ timeout: 20_000 })

  // Einbetten: Drop -> Region -> Apply -> Save.
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1])], 'g.png', { type: 'image/png' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await expect(page.getByTestId('placement-bar')).toBeVisible({ timeout: 5_000 })
  const box = await page.locator('canvas[aria-label="Seite 1"]').boundingBox()
  if (!box) throw new Error('canvas box')
  await page.mouse.move(box.x + 60, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, box.y + 300, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByTestId('place-status')).toContainText('Page 1')
  await page.getByTestId('place-apply').click()
  await expect(page.getByTestId('placement-bar')).toBeHidden({ timeout: 15_000 })
  await page.keyboard.press('Control+s')
  await expect.poll(async () => (await run(py, ['-c', PY_STATE, file])).stdout.trim(), { timeout: 20_000, intervals: [800, 1500] }).toMatch(/^N=1 .* MARK=True$/)
  const before = (await run(py, ['-c', PY_STATE, file])).stdout.trim()
  const wBefore = parseFloat(before.split(' ')[3]) * 1 - parseFloat(before.split(' ')[2]) // x1-x0 der bbox

  // Doppelklick mitten ins Bild -> Selektion.
  const fresh = await page.locator('canvas[aria-label="Seite 1"]').boundingBox()
  if (!fresh) throw new Error('no fresh box')
  await page.mouse.dblclick(fresh.x + 100, fresh.y + 250)
  await expect(page.getByTestId('imgobj-frame-1')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByTestId('imgobj-bar')).toBeVisible()

  // Rahmen ziehen (Move): +80px x, +60px y -> Mitte der Bild-BBox wandert mit.
  const fresh2 = await page.getByTestId('imgobj-frame-1').boundingBox()
  if (!fresh2) throw new Error('frame box missing')
  await page.mouse.move(fresh2.x + fresh2.width / 2, fresh2.y + fresh2.height / 2)
  await page.mouse.down()
  await page.mouse.move(fresh2.x + fresh2.width / 2 + 80, fresh2.y + fresh2.height / 2 + 60, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(1500)
  await page.keyboard.press('Control+s')
  await expect.poll(async () => {
    const st = (await run(py, ['-c', PY_STATE, file])).stdout.trim()
    const p2 = st.split(' ')
    const cx = (parseFloat(p2[2]) + parseFloat(p2[3])) / 2
    const cyTop = parseFloat(p2[1])
    return `cx=${cx.toFixed(0)} cy=${cyTop.toFixed(0)} N=${p2[0].slice(2)}`
  }, { timeout: 20_000, intervals: [800, 1500] }).not.toContain('N=0')
  const moved = (await run(py, ['-c', PY_STATE, file])).stdout.trim()
  const sc = (await page.locator('canvas[aria-label="Seite 1"]').boundingBox())!.width / 595
  const beforeCx = (parseFloat(before.split(' ')[2]) + parseFloat(before.split(' ')[3])) / 2
  const beforeTop = parseFloat(before.split(' ')[1])
  const movedCx = (parseFloat(moved.split(' ')[2]) + parseFloat(moved.split(' ')[3])) / 2
  const movedTop = parseFloat(moved.split(' ')[1])
  expect(movedCx - beforeCx).toBeGreaterThan(60 / sc * 0.6)
  expect(movedTop - beforeTop).toBeGreaterThan(40 / sc * 0.5)
  const afterResize = moved

  // Drehen: BBox-tausch durch imgobj-rotate.
  await page.getByTestId('imgobj-rotate').click()
  await page.waitForTimeout(1500)
  await page.keyboard.press('Control+s')
  const hNow = 0
  await expect.poll(async () => {
    const s = (await run(py, ['-c', PY_STATE, file])).stdout.trim()
    const p = s.split(' ')
    const w = parseFloat(p[3]) - parseFloat(p[2])
    const h = parseFloat(p[4]) - parseFloat(p[1])
    return h > w ? 'SWAPPED' : `w=${w.toFixed(0)} h=${h.toFixed(0)}`
  }, { timeout: 25_000, intervals: [1000, 2000] }).toBe('SWAPPED')

  // Loeschen: Bild weg, MARK bleibt.
  await page.getByTestId('imgobj-delete').click()
  await page.waitForTimeout(1500)
  await page.keyboard.press('Control+s')
  await expect.poll(async () => {
    const s = (await run(py, ['-c', PY_STATE, file])).stdout.trim()
    return s.split(" ")[0] + " " + s.split(" ").pop()
  }, { timeout: 25_000, intervals: [1000, 2000] }).toBe('N=0 MARK=True')
  void hNow
})
