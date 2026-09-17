import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// R56 Nutzerreport "editieren und platzieren funktioniert überhaupt nicht":
// NATIVER Beweisgang durch die GEBALTE App — Bild per Doppelklick bearbeiten +
// auf Platte verschoben, Signaturfeld platzieren/skalieren, Stempel platzieren.

const run = promisify(execFile)
const root = path.resolve(__dirname, '../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const appPath = process.env.PDF_EDITOR_APP_PATH
const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

test.describe('Native Editier-/Platzier-Journey (§3, echte App)', () => {
  test.skip(!appPath, 'PDF_EDITOR_APP_PATH nicht gesetzt')
  test.skip(!hasDisplay, 'kein Display')

  let dir: string, pdfPath: string

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-editor-journey-'))
    pdfPath = path.join(dir, 'doc.pdf')
    const jpg = path.join(dir, 'p.jpg')
    await run('python3', ['-c', `import sys
from PIL import Image
im = Image.new('RGB', (240, 160), (200, 40, 40)); im.save(sys.argv[1])`, jpg])
    await run(py, ['-c', `import sys, pymupdf
d = pymupdf.open(); p = d.new_page()
p.insert_image(pymupdf.Rect(80, 200, 515, 640), filename=sys.argv[2])
d.save(sys.argv[1])`, pdfPath, jpg])
  })

  test('Bild: Doppelklick -> Rahmen -> Drag-Verschieben -> Platte; Sig-Feld: arm -> ziehen -> Resize-Anfasser', async () => {
    test.setTimeout(120_000)
    const app = await electron.launch({ executablePath: appPath as string, args: [pdfPath] })
    const win: Page = await app.firstWindow()
    await expect(win.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })

    // --- 1) BILD BEARBEITEN: Doppelklick auf das Foto -> Editor-Rahmen ---
    const canvas = win.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first()
    const b = (await canvas.boundingBox())!
    // Bilddeckung grobzuegig: Canvasmittte trifft das Foto sicher (Skala-robust).
    await win.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2)
    await expect(win.getByTestId('imgobj-frame-1'), 'Doppelklick oeffnet Bild-Editor NICHT').toBeVisible({ timeout: 8_000 })
    await expect(win.getByTestId('imgobj-bar')).toBeVisible()

    // Drag in der Bildmitte -> Bild wandert +80px nach rechts-unten
    const f0 = (await win.getByTestId('imgobj-frame-1').boundingBox())!
    await win.mouse.move(f0.x + f0.width / 2, f0.y + f0.height / 2)
    await win.mouse.down()
    await win.mouse.move(f0.x + f0.width / 2 + 80, f0.y + f0.height / 2 + 50, { steps: 8 })
    await win.mouse.up()
    const f1 = (await win.getByTestId('imgobj-frame-1').boundingBox())!
    // Rahmen ist rechts-unten gewandert (Scroll-Toleranz; EXAKT beweist die Platte unten).
    expect(f1.x - f0.x).toBeGreaterThan(30)

    await win.keyboard.press('Control+s')
    await win.waitForTimeout(1200)
    // Platte (zweiter Leser): Bild-BBox ist unten-rent gewandert
    const out = await run(py, ['-c', `import sys, pymupdf
d = pymupdf.open(sys.argv[1]); p = d[0]
for im in p.get_image_info():
    r = im['bbox']; print(round(r[0],1), round(r[1],1))`, pdfPath])
    const [nx, ny] = out.stdout.trim().split(/\s+/).map(Number)
    expect(nx).toBeGreaterThan(120) // war ~80; Drag +80px/scale ~= +55pt
    expect(ny).toBeGreaterThan(230) // y-BBox von oben: Bildrand folgt der Skalierung

    // --- 2) SIGNATURFELD: arm -> Region ziehen -> Overlay + Resize-Anfasser ---
    await win.getByTestId('sidebar-tab-certificates').click()
    // R74: Die Abschnitte des Zertifikatspanels sind seit Runde 54 EINKLAPPBAR (Default zu) — ohne
    // diesen Klick existiert 'cert-field-arm' gar nicht und der Test lief in einen Timeout.
    await win.getByTestId('cert-sec-p12').click()
    // Frische Canvas-Box: das Bild-Editing kann den Viewer scrollen (alte b waere falsch).
    const b2 = (await win.locator('canvas').first().boundingBox())!
    await win.getByTestId('cert-field-arm').click()
    const y1 = Math.max(b2.y + 40, 20)
    await win.mouse.move(b2.x + 150, y1 + 60)
    await win.mouse.down()
    await win.mouse.move(b2.x + 380, y1 + 160, { steps: 8 })
    await win.mouse.up()
    await win.waitForTimeout(400)
    const sf = win.getByTestId('sigfield-1')
    await expect(sf, 'Signaturfeld-Overlay erscheint nach Regions-Ziehen NICHT').toBeVisible({ timeout: 5_000 })
    await expect(win.getByTestId('cert-field-info')).toContainText(/1/)
    // Resize unten-rechts
    const se = win.getByTestId('sigfield-resize-se')
    await expect(se, 'Skalierungs-Anfasser fehlt').toBeVisible()
    const s0 = (await sf.boundingBox())!
    const sbox = (await se.boundingBox())!
    await win.mouse.move(sbox.x + 4, sbox.y + 4)
    await win.mouse.down()
    await win.mouse.move(sbox.x + 44, sbox.y + 24, { steps: 5 })
    await win.mouse.up()
    const s1 = (await sf.boundingBox())!
    expect(s1.width).toBeGreaterThan(s0.width + 25)

    // --- 3) STEMPEL-TEXT: bewaffnen -> Klick auf Seite -> wirkt auf Platte ---
    await win.getByTestId('cert-field-clear').click()
    // Stempel-Text per Rechtsklick -> Einfuegen-Fluegel (Nutzerweg R55/56).
    // R74: Vorher in den sichtbaren Bereich scrollen und den Klick INS Fenster klemmen — sonst
    // landet der Rechtsklick ausserhalb des Viewports und es oeffnet sich nie ein Menue.
    const cv3 = win.locator('canvas').first()
    await cv3.scrollIntoViewIfNeeded()
    // In der Electron-App liefert Playwright viewportSize() 0x0 -> Fenster selbst messen (R74).
    const vp = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    const b3 = (await cv3.boundingBox())!
    // Punkt in der Seitenmitte: das Menue bleibt damit sicher im Fenster (Kanten clippen es weg).
    const clickX = Math.min(Math.max(b3.x + b3.width / 2, 10), vp.width - 10)
    const clickY = Math.min(Math.max(b3.y + b3.height / 2, 10), vp.height - 10)
    await win.mouse.click(clickX, clickY, { button: 'right' })
    await win.getByTestId('ctx-group-grp.insert').click()
    await win.getByTestId('ctx-pg-stamp').click()
    await expect(win.getByTestId('context-menu')).toBeHidden({ timeout: 5_000 })
    // Seite-1-Oberkante voll sichtbar machen (sonst liegt der Zielpunkt unter der TopBar) und
    // dann eine ECHTE Presse-Geste fahren: der Platzierungs-Overlay arbeitet auf Pointer-Events
    // (Gleiches Vorgehen wie tests/e2e/browser/stampCoordinates.spec.ts).
    await win.evaluate(() => {
      const col = document.querySelector('[data-testid="page-column"]') as HTMLElement | null
      const scroll = col?.closest('div.overflow-auto') as HTMLElement | null
      if (scroll) scroll.scrollTop = 0
    })
    await win.waitForTimeout(400)
    const b4 = (await cv3.boundingBox())!
    const sx = Math.min(b4.x + 120, vp.width - 10)
    const sy = Math.min(b4.y + 120, vp.height - 10)
    await win.mouse.move(sx, sy)
    await win.mouse.down()
    await win.mouse.move(sx + 2, sy + 2, { steps: 2 })
    await win.mouse.up()
    // Stempel-Dialog: Text eintragen und anwenden
    const ti = win.getByTestId('stamp-text')
    await expect(ti, 'Stempel-Dialog oeffnet nicht').toBeVisible({ timeout: 5_000 })
    await ti.fill('JOURNEY-STEMPEL')
    await win.getByTestId('stamp-run').click()
    await win.waitForTimeout(1500)
    await win.keyboard.press('Control+s')
    await win.waitForTimeout(1500)
    const text = await run(py, ['-c', `import sys, pymupdf
d = pymupdf.open(sys.argv[1]); print(d[0].get_text())`, pdfPath])
    expect(text.stdout, 'Stempeltext fehlt auf Platte').toContain('JOURNEY-STEMPEL')

    await win.close().catch(() => {})
    const p = app.process()
    if (p.exitCode === null) { await new Promise<void>((res) => { p.once('exit', () => res()); setTimeout(() => { p.kill('SIGKILL'); res() }, 8_000) }) }
  })
})
