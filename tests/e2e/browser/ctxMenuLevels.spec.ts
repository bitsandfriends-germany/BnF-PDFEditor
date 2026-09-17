// R55 Nutzerwunsch: Kontextmenues mit zwei Ebenen — Alltagsaktionen direkt,
// Kategorien als Flyout (Einfuegen -> Bild/Signatur/Text; PDF bearbeiten -> Split/...).
// Beweis bis auf die Platte: Signaturfeld per MENUE bewaffnen + Platzierung wirkt.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-ctx-'))
  file = path.join(dir, 'doc.pdf')
  await run(py, ['-c', 'import sys, pymupdf; d=pymupdf.open(); d.new_page(); d.new_page(); d.save(sys.argv[1])', file])
})

test('Rechtsklick: Alltagsebene flach + Kategorie-Flyouts; Einfuegen->Signaturfeld bewaffnet echt', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })

  const canvas = page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first()
  const b = (await canvas.boundingBox())!
  await page.mouse.click(b.x + 200, b.y + 200, { button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible({ timeout: 5_000 })

  // Ebene 1: Kategorien als Flyout-Knoepfe, Alltag (alles auswaehlen) direkt.
  await expect(menu.getByTestId('ctx-group-grp.insert')).toBeVisible()
  await expect(menu.getByTestId('ctx-group-grp.pdf')).toBeVisible()
  await expect(menu.getByTestId('ctx-group-grp.annotate')).toBeVisible()
  await expect(menu.getByTestId('ctx-pg-all')).toBeVisible()
  // Ebene-1-Fehlerbild: frueher standen 20 Punkte flach da — Seiten-Rotation ist jetzt IM Flyout.
  await expect(menu.getByTestId('ctx-pg-rot-right')).toHaveCount(0)

  // Flyout Ebene 2 oeffnen: Einfuegen -> Signaturfeld + Stempel-Bild + Stempel-Text.
  await menu.getByTestId('ctx-group-grp.insert').click()
  const sub = menu.getByTestId('ctx-submenu-grp.insert')
  await expect(sub.getByTestId('ctx-ins-sigfield')).toBeVisible()
  await expect(sub.getByTestId('ctx-pg-stamp-image')).toBeVisible()
  await expect(sub.getByTestId('ctx-pg-stamp')).toBeVisible()

  // PDF-bearbeiten-Flyout: Split statt generischem Punkt nicht — auf Canvas generisch.
  await menu.getByTestId('ctx-group-grp.pdf').click()
  const pdfSub = menu.getByTestId('ctx-submenu-grp.pdf')
  await expect(pdfSub.getByTestId('ctx-pg-split')).toBeVisible()
  await expect(pdfSub.getByTestId('ctx-pg-rot-right')).toBeVisible()

  // R56/57 Bug: Flyout sass INNERHALB des Menues -> abgeschnitten/Scrollbalken.
  // Kleines Viewport erzwingt den alten Fehler; Flyout muss jetzt ganz sichtbar sein.
  await page.keyboard.press('Escape') // Flugel zu
  await page.mouse.move(5, 5)
  await page.keyboard.press('Escape') // Menue zu
  await expect(menu).toBeHidden({ timeout: 3_000 })
  await page.setViewportSize({ width: 900, height: 560 })
  await page.waitForTimeout(400)
  const bS = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(bS.x + Math.min(200, bS.width / 2), bS.y + Math.min(200, bS.height / 2), { button: 'right' })
  await expect(menu).toBeVisible({ timeout: 4_000 })
  await menu.getByTestId('ctx-group-grp.pdf').click()
  const pdfSub2 = menu.getByTestId('ctx-submenu-grp.pdf')
  await expect(pdfSub2).toBeVisible()
  const sb = (await pdfSub2.boundingBox())!
  const vp = page.viewportSize()!
  expect(sb.x + sb.width).toBeLessThanOrEqual(vp.width + 1)
  expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height + 1)
  const inner = await menu.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }))
  expect(inner.sh, 'Kontextmenue braucht einen vertikalen Scrollbalken').toBeLessThanOrEqual(inner.ch + 2)
  expect(inner.sw, 'Kontextmenue braucht einen horizontalen Scrollbalken').toBeLessThanOrEqual(inner.cw + 2)
  // Sortieren-Funktion ist jetzt im PDF-Fluegel
  await expect(pdfSub2.getByTestId('ctx-pg-sort')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.keyboard.press('Escape')

  // Echter Effekt: Signaturfeld-Bewaffnung ueber das Menue startet den Platziermodus.
  // (PDF-Flyout war zuletzt offen und verdeckt den insert-Fluegel -> erneut oeffnen.)
  await menu.getByTestId('ctx-group-grp.insert').click()
  await sub.getByTestId('ctx-ins-sigfield').click()
  await expect(menu).toBeHidden({ timeout: 3_000 })
  // R58: Bewaffnung zeigt bewusst KEIN Overlay mehr (der Nutzer platziert per Klick).
  // Realer Effekt: ein Klick auf der Seite setzt das Feld sichtbar.
  const cbS = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(cbS.x + Math.min(300, cbS.width / 2), Math.max(140, Math.min(cbS.y + cbS.height * 0.5, 600)))
  await expect(page.getByTestId('sigfield-1')).toBeVisible({ timeout: 3_000 })
})
