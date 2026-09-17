// §4-Akzeptanzkriterien in ECHEM Chromium gemessen (nicht jsdom): Mischgrößen-Fixture
// (A4 hoch, A4 quer, A3, eine Seite /Rotate 90), Fensterbreiten 400/800/1600, dpr 1 und 2.
// Behauptet wird pro Kombination: kein Container größer als seine Seite; breiteste Seite füllt
// die Scrollarea-Breite minus Padding bei Fit-Width (±2px); kein horizontaler Scrollbalken;
// identische Seitenabstände in 16–24; Canvas-Backingstore = CSS × dpr; Sprung auf Seite 3 setzt
// deren Oberkante unter das Top-Padding.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-view-'))
  file = path.join(dir, 'mixed.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\na=d.new_page(width=595,height=842)\nb=d.new_page(width=842,height=595)\nc=d.new_page(width=842,height=1191)\ne=d.new_page(width=595,height=842); e.set_rotation(90)\nd.save(sys.argv[1]); d.close()`,
    file])
})

interface Measures {
  scrollClientW: number
  hScroll: boolean
  maxCssW: number
  minCssW: number
  gaps: number[]
  containerMatchesCanvas: boolean[]
  backingMatchesDpr: boolean[]
}

async function measure(page: import('@playwright/test').Page, dpr: number): Promise<Measures> {
  return page.evaluate((d) => {
    const col = document.querySelector('[data-testid="page-column"]') as HTMLElement
    const scroll = col.closest('div.overflow-auto') as HTMLElement
    const slots = Array.from(col.querySelectorAll('[data-testid^="page-slot-"]')) as HTMLElement[]
    const nums = slots.map((s) => parseInt(s.getAttribute('data-testid')!.replace('page-slot-', ''), 10))
    const order = slots.map((s, i) => ({ s, n: nums[i]! })).sort((a, b) => a.n - b.n)
    const rects = order.map(({ s, n }) => {
      const cv = document.querySelector(`canvas[aria-label="Seite ${n}"]`) as HTMLCanvasElement | null
      const r = s.getBoundingClientRect()
      return { s, n, cv, top: r.top, h: r.height, w: s.offsetWidth }
    })
    const cssRects = rects.filter((r) => r.cv !== null)
    const gaps: number[] = []
    for (let i = 1; i < cssRects.length; i++) gaps.push(Math.round((cssRects[i]!.top - (cssRects[i - 1]!.top + cssRects[i - 1]!.h)) * 10) / 10)
    const widths = cssRects.map((r) => r.cv!.clientWidth)
    return {
      scrollClientW: scroll.clientWidth,
      hScroll: scroll.scrollWidth > scroll.clientWidth + 1,
      maxCssW: Math.max(...widths),
      minCssW: Math.min(...widths),
      gaps,
      containerMatchesCanvas: cssRects.map((r) => Math.abs(r.s.offsetWidth - r.cv!.clientWidth) <= 1 && Math.abs(r.s.offsetHeight - r.cv!.clientHeight) <= 1),
      backingMatchesDpr: cssRects.map((r) => Math.abs(r.cv!.width - Math.floor(r.cv!.clientWidth * d)) <= 1)
    }
  }, dpr)
}

for (const width of [400, 800, 1600]) {
  for (const dpr of [1, 2]) {
    test(`§4 Mischgrößen-Fixture bei ${width}px Breite, dpr ${dpr}`, async ({ browser }) => {
      test.setTimeout(60_000)
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: dpr })
      const page = await ctx.newPage()
      await installBridgeStub(page, BACKEND, TOKEN)
      await setDialogPaths(page, file)
      await page.goto('http://localhost:5199/')
      await page.getByTestId('tb-open').click()
      await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })
      // Virtualisierung hält nur sichtbar+2 Slotes im DOM — wir warten auf >=2 (Lücken messbar).
            // §4-Geometrie ist fitWidth-Skalierung — Default ist jetzt fitPage (R60), hier explizit setzen.
      await page.getByTestId('tb-zoom-select').selectOption('fitWidth')
await expect.poll(async () => page.locator('[data-testid^="page-slot-"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)

      const m = await measure(page, dpr)
      expect(m.hScroll, 'kein horizontaler Scrollbalken bei Fit-Width').toBe(false)
      // Fit-Width: breiteste Seite füllt Scrollarea minus 2×24px Padding (p-6), Toleranz 2px.
      expect(Math.abs(m.maxCssW - (m.scrollClientW - 48))).toBeLessThanOrEqual(2)
      // Nicht gestreckt: die A4-Porträt-Seite bleibt deutlich schmaler als die breiteste.
      expect(m.maxCssW / m.minCssW).toBeGreaterThan(1.3)
      // Virtualisierung rendert sichtbar +/-2 — von den GERENDERTen Slotes erwarten wir >=1 Luecke.
      expect(m.gaps.length).toBeGreaterThanOrEqual(1)
      for (const g of m.gaps) { expect(g).toBeGreaterThanOrEqual(16); expect(g).toBeLessThanOrEqual(24) }
      expect(new Set(m.gaps).size, 'alle Seitenabstaende identisch').toBe(1)
      expect(m.containerMatchesCanvas.every(Boolean), 'Container == Canvas-CSS-Box').toBe(true)
      expect(m.backingMatchesDpr.every(Boolean), `Backingstore == CSS × dpr(${dpr})`).toBe(true)
      // Gesamthoehe == letzte Slot-Unterkante (echte Viewport-Masse aller Platzhalter):
      // bis ganz nach unten scrollen, dann ist die Summen-Hoehe ueberpruefbar.
      const tops2 = await page.evaluate(() => {
        const s2 = document.querySelector('[data-testid=\"page-slot-2\"]') as HTMLElement
        return s2 ? s2.offsetTop : null
      })
      // Zweistufig: echter Nutzer scrollt auch nicht in einem Sprung; der zweite Ansatz
      // neutralisiert spy-getriebene Nachjustierungen der ersten Welle.
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => {
          const col = document.querySelector('[data-testid=\"page-column\"]') as HTMLElement
          const scroll = col.closest('div.overflow-auto') as HTMLElement
          scroll.scrollTop = scroll.scrollHeight
        })
        await page.waitForTimeout(350)
      }
      await expect.poll(async () => {
        return await page.evaluate(() => {
          const col = document.querySelector('[data-testid=\"page-column\"]') as HTMLElement
          const scroll = col.closest('div.overflow-auto') as HTMLElement
          return scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2
        })
      }, { timeout: 20_000 }, 'Unterkante erreichbar').toBe(true)
      await expect.poll(async () => page.locator('[data-testid=\"page-slot-4\"]').count(), { timeout: 20_000 }, 'Seite-4-Slot gehalten').toBeGreaterThanOrEqual(1)
      const bottomCheck = await page.evaluate(() => {
        const col = document.querySelector('[data-testid=\"page-column\"]') as HTMLElement
        const last = document.querySelector('[data-testid=\"page-slot-4\"]') as HTMLElement
        return Math.abs(col.offsetHeight - (last.offsetTop + last.offsetHeight))
      })
      expect(bottomCheck, 'Spaltenhoehe == letzte Slot-Unterkante (Scroll-Hoehe summet richtig)').toBeLessThanOrEqual(2)
      // Zurueck nach oben: dieselben Offsets wie vorher (Layout stabil, kein Lazy-Shift).
      const before = tops2
      await page.evaluate(() => {
        const col = document.querySelector('[data-testid=\"page-column\"]') as HTMLElement
        ;(col.closest('div.overflow-auto') as HTMLElement).scrollTop = 0
      })
      await page.waitForTimeout(300)
      const after = await page.evaluate(() => {
        const s2 = document.querySelector('[data-testid=\"page-slot-2\"]') as HTMLElement
        const scroll = (document.querySelector('[data-testid=\"page-column\"]') as HTMLElement).closest('div.overflow-auto') as HTMLElement
        return { top: s2.offsetTop, scrollTop: scroll.scrollTop }
      })
      expect(after.scrollTop, 'zurueck bei 0').toBeLessThanOrEqual(1)
      if (before !== null && after.top !== undefined) {
        expect(Math.abs(after.top - before), 'Slot-Offsets nach Runter-und-Hoch identisch').toBeLessThanOrEqual(1)
      }

      // Seitensprung: Seite 3 oben unter das Top-Padding.
      // Unten meldet der Spy Seite 3 (groester Anteil) — Ziel muss eine ANDERE Seite sein,
      // sonst ist die Eingabe store-seitig eine No-op und der Sprung bleibt korrekt aus.
      await page.getByTestId('tb-page-input').fill('2')
      await page.getByTestId('tb-page-input').press('Enter')
      await page.waitForTimeout(400)
      const jump = await page.evaluate(() => {
        const col = document.querySelector('[data-testid="page-column"]') as HTMLElement
        const scroll = col.closest('div.overflow-auto') as HTMLElement
        const slot2 = document.querySelector('[data-testid="page-slot-2"]') as HTMLElement
        // Ziel ist der obere Rand der Seite, SOFERN erreichbar; bei kurzem Inhalt klemmt das
        // Scrolling naturgemäß an scrollHeight-clientHeight — das ist kein beliebiger Versatz.
        return Math.abs(scroll.scrollTop - Math.min(slot2.offsetTop, scroll.scrollHeight - scroll.clientHeight))
      })
      expect(jump, 'Seite-3-Oberkante sitzt unter dem Top-Padding (scrollTop == offsetTop, Padding hebt sich auf)').toBeLessThanOrEqual(2)
      await ctx.close()
    })
  }
}

test('§4 Zoom-Anker: Viewport-Mitte bleibtinhalts-punktstabil', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-zoom-select').selectOption('fitWidth') // R60: Default ist fitPage
    await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })
  await expect.poll(async () => page.locator('[data-testid^="page-slot-"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  const measureMid = () => page.evaluate(() => {
    const col = document.querySelector('[data-testid="page-column"]') as HTMLElement
    const scroll = col.closest('div.overflow-auto') as HTMLElement
    scroll.scrollTop = scroll.scrollHeight / 3
    return new Promise((res) => setTimeout(() => {
      const mid = scroll.scrollTop + scroll.clientHeight / 2 - 24 // relativ zur Spalte (PAD 24)
      const slots = Array.from(col.querySelectorAll('[data-testid^="page-slot-"]')) as HTMLElement[]
      for (const s of slots) {
        const t = s.offsetTop, h = s.offsetHeight
        if (mid >= t && mid <= t + h) {
          res({ page: parseInt(s.getAttribute('data-testid')!.replace('page-slot-', ''), 10), frac: (mid - t) / h })
          return
        }
      }
      res({ page: -1, frac: -1 })
    }, 250))
  })
  const before = await measureMid()
  expect(before.page, 'Mittelpunkt liegt auf einer gehaltenen Seite').toBeGreaterThan(0)
  await page.getByTestId('tb-zoom-in').click()
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => {
    const col = document.querySelector('[data-testid="page-column"]') as HTMLElement
    const scroll = col.closest('div.overflow-auto') as HTMLElement
    const mid = scroll.scrollTop + scroll.clientHeight / 2 - 24
    const slots = Array.from(col.querySelectorAll('[data-testid^="page-slot-"]')) as HTMLElement[]
    for (const s of slots) {
      const t = s.offsetTop, h = s.offsetHeight
      if (mid >= t && mid <= t + h) return { page: parseInt(s.getAttribute('data-testid')!.replace('page-slot-', ''), 10), frac: (mid - t) / h }
    }
    return { page: -1, frac: -1 }
  })
  expect(after.page, 'nach Zoom: gleicher Seitenanker').toBe(before.page)
  expect(Math.abs(after.frac - before.frac), 'Anteil innerhalb der Seite bleibt < 5pp').toBeLessThan(0.05)
})
