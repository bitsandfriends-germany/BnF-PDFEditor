// R70 Browser-E2E: Anzeige-Drehung (Drehpfeile) muss die Seite WIRKLICH drehen — nicht
// "nur zoomen". Nutzerbefund: pdfjs brach den zweiten Render auf derselben Canvas ab
// ("Cannot use the same canvas during multiple render() operations"), die Geometrie blieb auf dem
// alten Stand und die gedrehte Bitmap lag gestaucht in der alten Box.
// Geprueft wird am echten Viewer (Canvas-Pixel!) und an der PLATTENDATEI:
//  - Aenderung: dunkler Block wandert von links-oben nach rechts-oben (90°), unten-rechts (180°),
//    unten-links (270°); Canvas-Mass und CSS-Box stimmen ueberein (keine Stauchung); der Slot der
//    Spalte ist mitgedreht (sonst wird die Seite beschnitten).
//  - NICHT-Aenderung: die Datei auf der Platte bleibt byte-identisch (Anzeige-Drehung ist rein
//    visuell; die Seitenrotation im Dokument ist der Befehl pg-rot-*, separat abgedeckt).
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

const CANVAS = 'canvas[aria-label^="Seite"], canvas[aria-label^="Page"]'

interface Probe {
  bitmap: string
  css: string
  boxStyle: string
  slot: string
  quadrant: string
  dark: number
  badge: string
}

test.describe('R70: Anzeige-Drehung', () => {
  let file: string

  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-rot-'))
    file = path.join(dir, 'portrait.pdf')
    // A4 hochkant, dunkler Block in der ANSICHT links-oben (PyMuPDF rechnet y von oben).
    await run(py, ['-c', `import sys, fitz
d=fitz.open()
p=d.new_page(width=595, height=842)
p.draw_rect(fitz.Rect(40, 40, 240, 340), color=(0,0,0), fill=(0,0,0))
d.save(sys.argv[1]); d.close()`, file])
  })

  test.beforeEach(async ({ page }) => {
    await installBridgeStub(page, BACKEND, TOKEN)
    await setDialogPaths(page, file)
    await page.goto('http://localhost:5199/')
    await page.getByTestId('tb-open').click()
    await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
    await expect(page.locator(CANVAS).first()).toBeVisible({ timeout: 30_000 })
  })

  test('Drehpfeile drehen die Ansicht wirklich; Datei bleibt unveraendert', async ({ page }) => {
    test.setTimeout(90_000)
    const fileHash = async (): Promise<string> => {
      const ab = await (await fetch(`${BACKEND}/document/file`, { headers: { 'X-Auth-Token': TOKEN } })).arrayBuffer()
      const tmp = path.join(os.tmpdir(), `rot-hash-${Date.now()}.pdf`)
      fs.writeFileSync(tmp, Buffer.from(ab))
      const { stdout } = await run(py, ['-c', 'import sys, hashlib; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())', tmp])
      fs.unlinkSync(tmp)
      return stdout.trim()
    }

    const probe = async (): Promise<Probe> =>
      await page.evaluate((sel) => {
        const cv = document.querySelector(sel) as HTMLCanvasElement
        const box = cv.parentElement as HTMLElement
        const slot = box.parentElement as HTMLElement
        const ctx = cv.getContext('2d') as CanvasRenderingContext2D
        const img = ctx.getImageData(0, 0, cv.width, cv.height).data
        let n = 0
        let sx = 0
        let sy = 0
        for (let y = 0; y < cv.height; y += 3) {
          for (let x = 0; x < cv.width; x += 3) {
            const i = (y * cv.width + x) * 4
            if (img[i] + img[i + 1] + img[i + 2] < 200) {
              n++
              sx += x
              sy += y
            }
          }
        }
        const cx = n > 0 ? sx / n : 0
        const cy = n > 0 ? sy / n : 0
        const quad = `${cy < cv.height / 2 ? 'oben' : 'unten'}-${cx < cv.width / 2 ? 'links' : 'rechts'}`
        const r = (el: Element): string => {
          const b = el.getBoundingClientRect()
          return `${Math.round(b.width)}x${Math.round(b.height)}`
        }
        return {
          bitmap: `${cv.width}x${cv.height}`,
          css: r(cv),
          boxStyle: `${box.style.width}/${box.style.height}`,
          slot: r(slot),
          quadrant: quad,
          dark: n,
          badge: document.querySelector('[data-testid="view-rotation-badge"]')?.textContent ?? ''
        }
      }, CANVAS)

    const hashBefore = await fileHash()
    const start = await probe()
    expect(start.dark, 'dunkler Block ueberhaupt sichtbar').toBeGreaterThan(200)
    expect(start.quadrant, 'Startlage (0°): Block links-oben').toBe('oben-links')
    // Hochformat: Bitmap hoeher als breit
    const [sw, sh] = start.bitmap.split('x').map(Number)
    expect(sw, 'A4 hochkant ist schmaler als hoch').toBeLessThan(sh)
    // Keine Stauchung: CSS-Box == Bitmap (Toleranz 2 px)
    {
      const [bw, bh] = start.bitmap.split('x').map(Number)
      const [cw, ch] = start.css.split('x').map(Number)
      expect(Math.abs(bw - cw), 'Box-Breite == Bitmap-Breite').toBeLessThanOrEqual(2)
      expect(Math.abs(bh - ch), 'Box-Hoehe == Bitmap-Hoehe').toBeLessThanOrEqual(2)
    }

    // Erwartete Drehung samt Blocklage abwarten — Badge zuerst (eindeutiger Zustand), dann Pixel.
    const expectRotation = async (deg: number, quadrant: string): Promise<void> => {
      if (deg === 0) await expect(page.getByTestId('view-rotation-badge')).toHaveCount(0)
      else await expect(page.getByTestId('view-rotation-badge')).toContainText(String(deg))
      await expect.poll(async () => (await probe()).quadrant, { timeout: 20_000, message: `${deg}° -> ${quadrant}` }).toBe(quadrant)
    }
    const sizeCheck = async (label: string): Promise<Probe> => {
      const p = await probe()
      const [bw, bh] = p.bitmap.split('x').map(Number)
      const [cw, ch] = p.css.split('x').map(Number)
      expect(Math.abs(bw - cw), `${label}: Box-Breite == Bitmap-Breite`).toBeLessThanOrEqual(2)
      expect(Math.abs(bh - ch), `${label}: Box-Hoehe == Bitmap-Hoehe`).toBeLessThanOrEqual(2)
      return p
    }

    // --- 90° rechts: Block wandert nach rechts-oben, Bitmap wird quer ---
    await page.getByTestId('view-rot-right').click()
    await expectRotation(90, 'oben-rechts')
    const r90 = await sizeCheck('90°')
    const [w90, h90] = r90.bitmap.split('x').map(Number)
    expect(w90, 'quer nach 90°').toBeGreaterThan(h90)
    {
      const [slotW, slotH] = r90.slot.split('x').map(Number)
      expect(slotW, 'Spalten-Slot ist mitgedreht (sonst Beschnitt)').toBeGreaterThan(slotH)
    }

    // --- 180°: Block unten-rechts ---
    await page.getByTestId('view-rot-right').click()
    await expectRotation(180, 'unten-rechts')
    await sizeCheck('180°')

    // --- 270°: Block unten-links ---
    await page.getByTestId('view-rot-right').click()
    await expectRotation(270, 'unten-links')
    await sizeCheck('270°')

    // --- stufenweise zurueck (270 -> 180 -> 90 -> 0) ---
    await page.getByTestId('view-rot-left').click()
    await expectRotation(180, 'unten-rechts')
    await page.getByTestId('view-rot-left').click()
    await expectRotation(90, 'oben-rechts')

    // --- zurueck auf 0°: Ausgangslage, hochkant und ohne Badge ---
    await page.getByTestId('view-rot-left').click()
    await expectRotation(0, 'oben-links')
    const back = await sizeCheck('zurueck auf 0°')
    // Die Fit-Skalierung darf sich minimal unterscheiden (Scrollbalken aendert die
    // Verfuegbarkeitshoehe um wenige px) — entscheidend sind Orientierung und Groesse.
    const [bw, bh] = back.bitmap.split('x').map(Number)
    const [stw, sth] = start.bitmap.split('x').map(Number)
    expect(bw, 'wieder hochkant').toBeLessThan(bh)
    expect(Math.abs(bw - stw) / stw, 'Ausgangsgroesse (Breite) ±5%').toBeLessThan(0.05)
    expect(Math.abs(bh - sth) / sth, 'Ausgangsgroesse (Hoehe) ±5%').toBeLessThan(0.05)

    // NICHT-Aenderung: Anzeige-Drehung hat die Datei nicht angefasst.
    expect(await fileHash(), 'Datei byte-identisch nach reiner Anzeige-Drehung').toBe(hashBefore)
  })

  test('gedrehte Ansicht: Signaturfeld zieht unter dem Zeiger mit (keine Achsenverdrehung)', async ({ page }) => {
    test.setTimeout(90_000)
    // Feld VOR der Drehung platzieren (Normalfall des Nutzers), dann Ansicht drehen.
    await page.getByTestId('sidebar-tab-certificates').click()
    await page.getByTestId('cert-sec-p12').click()
    await page.getByTestId('cert-field-arm').click()
    const cb = (await page.locator(CANVAS).first().boundingBox())!
    const fx = cb.x + Math.min(200, cb.width * 0.4)
    const fy = cb.y + Math.min(240, cb.height * 0.4)
    await page.mouse.click(fx, fy)
    const sf = page.getByTestId('sigfield-1')
    await expect(sf).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('view-rot-right').click()
    await expect(page.getByTestId('view-rotation-badge')).toContainText('90')
    await expect(page.getByTestId('rot-overlay-1'), 'gedrehte Overlay-Huelle aktiv').toHaveCount(1)
    await page.waitForTimeout(600)

    const before = (await sf.boundingBox())!
    const startX = before.x + before.width / 2
    const startY = before.y + before.height / 2
    // Ziehen: 60 px nach RECHTS auf dem Bildschirm. Das Feld muss dem Zeiger folgen —
    // vor dem Fix lief es quer (Achsenverdrehung durch die gedrehte Huelle).
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 60, startY, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = (await sf.boundingBox())!
    const endX = after.x + after.width / 2
    const endY = after.y + after.height / 2
    expect(Math.abs((endX - startX) - 60), 'Feld folgt dem Zeiger horizontal (±12 px)').toBeLessThanOrEqual(12)
    expect(Math.abs(endY - startY), 'kein Achsenversatz vertikal (±12 px)').toBeLessThanOrEqual(12)

    // Gegenprobe bei 270°: Ziehen nach rechts muss ebenfalls horizontal bleiben.
    await page.getByTestId('view-rot-left').click()
    await page.getByTestId('view-rot-left').click() // 90 -> 0 -> 270
    await expect(page.getByTestId('view-rotation-badge')).toContainText('270')
    await page.waitForTimeout(600)
    const b2 = (await sf.boundingBox())!
    const sx2 = b2.x + b2.width / 2
    const sy2 = b2.y + b2.height / 2
    await page.mouse.move(sx2, sy2)
    await page.mouse.down()
    await page.mouse.move(sx2 - 50, sy2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const a2 = (await sf.boundingBox())!
    expect(Math.abs((a2.x + a2.width / 2 - sx2) + 50), '270°: Feld folgt dem Zeiger (±12 px)').toBeLessThanOrEqual(12)
    expect(Math.abs(a2.y + a2.height / 2 - sy2), '270°: kein Achsenversatz (±12 px)').toBeLessThanOrEqual(12)
  })
})
