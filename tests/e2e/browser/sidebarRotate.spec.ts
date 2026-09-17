// R71 Browser-E2E: Die Drehpfeile der Seitenleiste (Bereich "Pages", data-testid thumb-rotate-N)
// muessen die Seite WIRKLICH drehen. Nutzerbefund: "das pdf drehen funktioniert nicht, wenn ich
// die drehpfeile klicke zoomt es nur".
// Ursache war: der Viewer rief page.getViewport({scale, rotation: viewRotation}) mit expliziter 0
// auf — damit ERSETZT pdfjs die im Dokument gespeicherte Seitenrotation (/Rotate). Die Datei und
// die Thumbnails waren gedreht, die Hauptansicht blieb ungedreht, waehrend Fit/Zoom schon fuer die
// gedrehte Seite rechneten (= Eindruck "nur Zoom").
// Geprueft wird am echten Viewer (Canvas-Pixel), an der PLATTENDATEI (pikepdf, zweite Bibliothek)
// und am Formularfeld auf gedrehter Seite (Position + Wert auf der Platte).
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

/** Seitenrotation + Feldwert direkt aus der PLATTENDATEI (pikepdf = zweite Bibliothek). */
const PY_STATE = `
import sys, urllib.request, pikepdf, io
req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})
raw=urllib.request.urlopen(req).read()
p=pikepdf.open(io.BytesIO(raw))
rots=[int(p.pages[i].get('/Rotate',0)) for i in range(len(p.pages))]
af=p.Root.get('/AcroForm')
flds=list(af.get('/Fields')) if af else []
val=str(flds[0].get('/V')) if flds else '-'
print('%d|%s|%s' % (len(p.pages), ','.join(str(r) for r in rots), val))
`

async function pdfState(): Promise<{ pages: number; rots: number[]; value: string }> {
  const tmp = path.join(os.tmpdir(), `sdrot-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  const ab = await (await fetch(`${BACKEND}/document/file`, { headers: { 'X-Auth-Token': TOKEN } })).arrayBuffer()
  fs.writeFileSync(tmp, Buffer.from(ab))
  const { stdout } = await run(py, ['-c', PY_STATE, BACKEND, TOKEN])
  fs.unlinkSync(tmp)
  const parts = stdout.trim().split('|')
  return {
    pages: Number(parts[0]),
    rots: (parts[1] ?? '').split(',').filter((x) => x !== '').map(Number),
    value: parts[2] ?? '-'
  }
}

/** Schwerpunkt der dunklen Pixel der Hauptseite + Canvas-Masse. */
async function mainProbe(page: import('@playwright/test').Page): Promise<{ size: string; quad: string; dark: number }> {
  return await page.evaluate((sel) => {
    const cv = document.querySelector(sel) as HTMLCanvasElement
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
    const quad = n > 0 ? `${sy / n < cv.height / 2 ? 'oben' : 'unten'}-${sx / n < cv.width / 2 ? 'links' : 'rechts'}` : 'leer'
    return { size: `${cv.width}x${cv.height}`, quad, dark: n }
  }, CANVAS)
}

test.describe('R71: Drehpfeile der Seitenleiste', () => {
  let file: string
  let formFile: string

  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-sdrot-'))
    file = path.join(dir, 'pages.pdf')
    // Zwei A4-Seiten; Seite 1 mit dunklem Block links-oben (Pixel-Beweis der Drehung).
    await run(py, ['-c', `import sys, fitz
d=fitz.open()
p1=d.new_page(width=595, height=842)
p1.draw_rect(fitz.Rect(40, 40, 240, 340), color=(0,0,0), fill=(0,0,0))
p2=d.new_page(width=595, height=842)
p2.insert_text((72, 72), 'SEITE ZWEI')
d.save(sys.argv[1]); d.close()`, file])
    // Separate Datei: Formularfeld, damit Test 3 die Feldlage auf gedrehter Seite prueft.
    formFile = path.join(dir, 'form.pdf')
    await run(py, ['-c', `import sys, pymupdf
d=pymupdf.open()
p=d.new_page(width=595, height=842)
p.insert_text((72,80),'ROTFORMMARK',fontsize=18)
w=pymupdf.Widget()
w.field_name='Feld1'
w.field_type=pymupdf.PDF_WIDGET_TYPE_TEXT
w.rect=pymupdf.Rect(70,140,280,165)
w.text=''
p.add_widget(w)
d.save(sys.argv[1]); d.close()`, formFile])
  })

  const openFile = async (page: import('@playwright/test').Page, target: string): Promise<void> => {
    await installBridgeStub(page, BACKEND, TOKEN)
    await setDialogPaths(page, target)
    await page.goto('http://localhost:5199/')
    await page.getByTestId('tb-open').click()
    await expect(page.getByTestId('page-count')).toContainText(/[12]/, { timeout: 30_000 })
    await expect(page.locator(CANVAS).first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(600)
  }

  test('thumb-rotate-0 dreht Seite 1 in Datei UND Hauptansicht; Undo stellt alles zurueck', async ({ page }) => {
    test.setTimeout(120_000)
    await openFile(page, file)

    const before = await pdfState()
    expect(before.pages, 'zwei Seiten bleiben').toBe(2)
    expect(before.rots, 'Ausgangslage ohne Drehung').toEqual([0, 0])
    const p0 = await mainProbe(page)
    expect(p0.quad, 'Startlage: Block links-oben').toBe('oben-links')
    const [w0, h0] = p0.size.split('x').map(Number)
    expect(w0, 'A4 hochkant').toBeLessThan(h0)

    await page.getByTestId('thumb-rotate-0').click()

    // AENDERUNG auf der Platte (pikepdf): /Rotate der Seite 1 ist 90, Seite 2 unveraendert.
    await expect.poll(async () => (await pdfState()).rots.join(','), { timeout: 30_000 }).toBe('90,0')

    // AENDERUNG in der Hauptansicht: quer + Block rechts-oben (echte Drehung, kein Zoom).
    await expect.poll(async () => (await mainProbe(page)).quad, { timeout: 30_000, message: 'Hauptansicht gedreht' }).toBe('oben-rechts')
    const p90 = await mainProbe(page)
    const [w90, h90] = p90.size.split('x').map(Number)
    expect(w90, 'Hauptansicht ist jetzt quer').toBeGreaterThan(h90)
    expect(p90.dark, 'Seiteninhalt weiterhin gezeichnet').toBeGreaterThan(200)

    // AENDERUNG im Thumbnail: Kachel von Seite 1 ist quer.
    const thumbSizes = async (): Promise<string[]> =>
      await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="thumb-item-"] canvas')).map((c) => {
        const el = c as HTMLCanvasElement
        return `${el.width}x${el.height}`
      }))
    await expect.poll(async () => {
      const t = await thumbSizes()
      const [tw, th] = (t[0] ?? '0x0').split('x').map(Number)
      return tw > th
    }, { timeout: 20_000, message: 'Thumbnail 1 quer' }).toBe(true)
    const t2 = await thumbSizes()
    const [t2w, t2h] = (t2[1] ?? '0x0').split('x').map(Number)
    expect(t2w, 'Thumbnail 2 bleibt hochkant').toBeLessThan(t2h)

    // NICHT-AENDERUNG der anderen Seite: Datei bleibt 2-seitig, Seite 2 ohne /Rotate.
    expect((await pdfState()).pages).toBe(2)

    // Undo: Datei und Ansicht kehren zur Ausgangslage zurueck.
    await expect(page.getByTestId('tb-undo')).toBeEnabled({ timeout: 20_000 })
    await page.getByTestId('tb-undo').click()
    await expect.poll(async () => (await pdfState()).rots.join(','), { timeout: 30_000 }).toBe('0,0')
    await expect.poll(async () => (await mainProbe(page)).quad, { timeout: 30_000, message: 'Ansicht zurueckgedreht' }).toBe('oben-links')
  })

  test('thumb-rotate-1 trifft genau die zweite Seite (kein Versatz)', async ({ page }) => {
    test.setTimeout(90_000)
    await openFile(page, file)
    expect((await pdfState()).rots).toEqual([0, 0])

    await page.getByTestId('thumb-rotate-1').click()
    await expect.poll(async () => (await pdfState()).rots.join(','), { timeout: 30_000 }).toBe('0,90')

    // Thumbnails: nur die zweite Kachel ist quer (Neuzeichnen abwarten).
    const sizes = async (): Promise<{ w: number; h: number }[]> =>
      await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="thumb-item-"] canvas')).map((c) => {
        const el = c as HTMLCanvasElement
        return { w: el.width, h: el.height }
      }))
    await expect.poll(async () => {
      const s2 = await sizes()
      return (s2[1]?.w ?? 0) > (s2[1]?.h ?? 0)
    }, { timeout: 20_000, message: 'Thumbnail 2 quer' }).toBe(true)
    const finalSizes = await sizes()
    expect(finalSizes[0]!.w, 'Thumbnail 1 unveraendert hochkant').toBeLessThan(finalSizes[0]!.h)
  })

  test('gedrehte Seite: Formularfeld sitzt weiterhin auf der richtigen Stelle und laesst sich fuellen', async ({ page }) => {
    test.setTimeout(120_000)
    await openFile(page, formFile)
    const input = page.getByTestId('form-field-Feld1')
    await expect(input).toBeVisible({ timeout: 20_000 })

    // Lage des Feldes im LOKALEN Rahmen der Overlay-Huelle als Bruchteil der Huellengroesse.
    // Diese Groesse ist skalenunabhaengig und darf sich durch eine Anzeige-Drehung NICHT aendern
    // (PDF-Raum-Platzierung). Vor dem Fix rutschte das Feld um die halbe Seitenhoehe.
    const localFraction = async (): Promise<{ fx: number; fy: number }> =>
      await page.evaluate(() => {
        const wrap = document.querySelector('[data-testid^="form-rot-layer-"]') as HTMLElement
        const inp = document.querySelector('[data-testid="form-field-Feld1"]') as HTMLElement
        const wb = wrap.getBoundingClientRect()
        const ib = inp.getBoundingClientRect()
        const total = Number((/([0-9.]+)deg/.exec(wrap.style.transform)?.[1] ?? '0'))
        const cx = ib.x + ib.width / 2 - (wb.x + wb.width / 2)
        const cy = ib.y + ib.height / 2 - (wb.y + wb.height / 2)
        const rad = (-total * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const lx = cx * cos - cy * sin
        const ly = cx * sin + cy * cos
        const w = parseFloat(wrap.style.width)
        const h = parseFloat(wrap.style.height)
        return { fx: (lx + w / 2) / w, fy: (ly + h / 2) / h }
      })

    const before = await localFraction()
    await page.getByTestId('thumb-rotate-0').click()
    await expect.poll(async () => (await pdfState()).rots.join(','), { timeout: 30_000 }).toBe('90')

    // Warten, bis Neuzeichnen UND der Formular-Nachladen (form-fields) durch sind — sonst
    // wuerde eine spaete Verschiebung des Feldes unbemerkt bleiben.
    await page.waitForTimeout(1800)
    const after = await localFraction()
    expect(
      Math.abs(after.fx - before.fx) + Math.abs(after.fy - before.fy),
      `Feld bleibt im PDF-Raum an derselben Stelle (vorher ${before.fx.toFixed(3)}/${before.fy.toFixed(3)}, nachher ${after.fx.toFixed(3)}/${after.fy.toFixed(3)})`
    ).toBeLessThan(0.03)
    console.log(`FELD-LAGE vorher fx=${before.fx.toFixed(3)} fy=${before.fy.toFixed(3)} nachher fx=${after.fx.toFixed(3)} fy=${after.fy.toFixed(3)}`)

    // Und der Bedienpfad funktioniert: fuellen -> Wert steht in der Datei (pikepdf).
    await input.click()
    await input.fill('ROTFORM')
    await input.blur()
    await expect.poll(async () => (await pdfState()).value, { timeout: 30_000 }).toContain('ROTFORM')
  })
})
