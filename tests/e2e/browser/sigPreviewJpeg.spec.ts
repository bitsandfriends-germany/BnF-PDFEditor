// Nutzerbefund Runde 51: Signatur-Vorschau "haut nicht hin" — importierte JPEGs wurden als
// image/png deklariert und konnten nicht dekodiert werden. Beweis mit echtem JPEG:
// echtes JPEG dekodiert (naturalWidth>0, MIME=image/jpeg) + Platzierung landet im Dokument.
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
let jpg: string
let jpgB64: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-sigjpg-'))
  file = path.join(dir, 'doc.pdf')
  jpg = path.join(dir, 'unterschrift.jpg')
  const r = await run(py, ['-c',
    `import sys, base64, pymupdf\nd=pymupdf.open()\np=d.new_page()\np.insert_text((72,120),'MARK-P1',fontsize=24)\nd.save(sys.argv[1]); d.close()\nfrom PIL import Image\nim=Image.new('RGB',(60,30),(240,235,220))\nfrom PIL import ImageDraw\nImageDraw.Draw(im).line([(4,25),(56,5)], fill=(20,20,120), width=3)\nim.save(sys.argv[2],'JPEG')\nprint(base64.b64encode(open(sys.argv[2],'rb').read()).decode())`,
    file, jpg])
  jpgB64 = r.stdout.trim()
})

test('JPEG-Signatur: echtes Vorschaubild + Platzierung im Dokument', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setStampImage(page, jpg, jpgB64)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })

  await page.getByTestId('sidebar-tab-signatures').click()
  await page.getByTestId('sig-name').fill('Foto-Signatur')
  await page.getByTestId('sig-import').click()
  const delBtn = page.locator('[data-testid^="sig-del-"]')
  await expect(delBtn.first()).toBeVisible({ timeout: 15_000 })
  // Exakt DIESE Signatur treffen (Bibliothek ist global; first() waehre eine
  // importierte Fremd-Signatur der Reihenfolge nach).
  const row = page.locator('li', { hasText: 'Foto-Signatur' }).first()
  const thumb = row.locator('[data-testid^="sig-thumb-"]').first()
  await expect(thumb).toBeVisible({ timeout: 10_000 })
  // Kern-Assertion: echtes JPEG dekodiert (naturalWidth>0, MIME=image/jpeg).
  const info = await thumb.evaluate((el) => {
    const img = el as HTMLImageElement
    return { w: img.naturalWidth, src: img.currentSrc.slice(0, 22) }
  })
  expect(info.w).toBeGreaterThan(0)
  expect(info.src).toBe('data:image/jpeg;base64')

  // Platzieren -> Region -> Einbetten -> Save.
  const place = row.locator('[data-testid^="sig-place-"]').first()
  await place.click()
  await expect(page.getByTestId('placement-bar')).toBeVisible()
  const canvas = page.locator('canvas[aria-label="Seite 1"]')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas box')
  await page.mouse.move(box.x + 80, box.y + 160)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 230, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByTestId('place-status')).toContainText('Page 1')
  await page.getByTestId('place-apply').click()
  await expect(page.getByTestId('placement-bar')).toBeHidden({ timeout: 15_000 })
  await page.keyboard.press('Control+s')

  const PY = `
import sys, pymupdf
d=pymupdf.open(sys.argv[1])
ii=d[0].get_image_info()
print('DRAW=%d MARK=%s' % (len(ii), 'MARK-P1' in d[0].get_text()))
`
  await expect.poll(async () => (await run(py, ['-c', PY, file])).stdout.trim(), { timeout: 30_000, intervals: [1000, 2000] }).toBe('DRAW=1 MARK=True')
})
