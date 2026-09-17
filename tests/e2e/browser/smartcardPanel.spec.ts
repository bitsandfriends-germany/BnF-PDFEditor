// UI-Livewechweis Smartcard-Panel (echte Karte auf diesem Rechner; sonst skip):
// "Karte lesen" -> Geraeteliste sichtbar -> Signatur-Zertifikat (Subjekt) waehlbar.
// Es wird NICHT signiert (PIN-Sperrrisiko) — Signieren ist dem Nutzer vorbehalten.
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
let cardPresent = false
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-sc-'))
  file = path.join(dir, 'doc.pdf')
  await run(py, ['-c', `import sys, pymupdf\nd=pymupdf.open()\np=d.new_page()\np.insert_text((72,120),'MARK-P1',fontsize=24)\nd.save(sys.argv[1])`, file])
  const r = await fetch(`${BACKEND}/pkcs11/devices`, { headers: { 'X-Auth-Token': TOKEN } })
  cardPresent = ((await r.json()).devices ?? []).length > 0
})

test('Smartcard-Panel liest echte Karte und zeigt Signatur-Zertifikat', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await page.getByTestId('sidebar-tab-certificates').click()
  // Integrierter Ablauf: Smartcard-Bereich ist standardmaessig eingeklappt.
  await page.getByTestId('cert-sec-sc').click()
  await page.getByTestId('cert-sc-load').click()
  if (!cardPresent) {
    await expect(page.getByTestId('cert-sc-device')).toHaveCount(0)
    test.skip(true, 'keine Karte im Leser')
    return
  }
  await expect(page.getByTestId('cert-sc-device')).toBeVisible({ timeout: 15_000 })
  // Signatur-Zertifikat (id 02) ist auf IDEMIA/eID an PIN2-Slot — Geraet durchwechseln.
  const opts = page.getByTestId('cert-sc-device').locator('option')
  const n = await opts.count()
  let sawCert = false
  for (let i = 0; i < n && !sawCert; i++) {
    await page.getByTestId('cert-sc-device').selectOption({ index: i })
    await page.waitForTimeout(700)
    const c = page.locator('[data-testid^="cert-sc-cert-"]')
    if (await c.count() > 0) {
      const txt = await c.first().innerText()
      sawCert = txt.includes('BARTH') || /20\d\d/.test(txt)
    }
  }
  expect(sawCert).toBe(true)
  // R58 Nutzerablauf: Signieren = ERST Feld per Klick platzieren, DANN PIN-Dialog.
  // Abbrechen sendet nichts (kartenschonend, keine Fehl-PIN).
  const cert = page.locator('[data-testid^="cert-sc-cert-"]')
  await cert.first().click()
  await page.getByTestId('cert-sc-sign').click()
  // Bewaffnung laeuft: noch kein Dialog, stattdessen Platzier-Hinweis.
  await expect(page.getByTestId('pin-dialog')).toHaveCount(0)
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(cb.x + Math.min(300, cb.width / 2), Math.max(140, Math.min(cb.y + cb.height * 0.5, 600)))
  await expect(page.getByTestId('sigfield-1')).toBeVisible({ timeout: 4_000 })
  await expect(page.getByTestId('pin-dialog')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('pin-input')).toHaveAttribute('type', 'password')
  // R59: nur EINE PIN (PIN2) — kein zweites SigPin-Feld mehr.
  await expect(page.getByTestId('pin-sigpin')).toHaveCount(0)
  await page.getByTestId('pin-cancel').click()
  await expect(page.getByTestId('pin-dialog')).toHaveCount(0)
  // R61: Detail-Popup — Bezeichner-Spalte breit genug, dass lange Werte (OID) nicht
  // in die Labels laufen.
  const detailBtn = page.locator('[data-testid^="cert-sc-detail-"]')
  await expect(detailBtn.first()).toBeVisible()
  await detailBtn.first().click()
  const modal = page.getByTestId('cert-sc-detail-modal')
  await expect(modal).toBeVisible()
  // Kein überlaufender Inhalt: jede dd-Box bleibt schmaler als ihr Gitterfach.
  const overflow = await modal.evaluate((root) => {
    let bad = 0
    root.querySelectorAll('dd').forEach((dd) => {
      const grid = dd.parentElement as HTMLElement
      if (dd.scrollWidth > grid.clientWidth + 1 && !getComputedStyle(dd).wordBreak.startsWith('break')) bad++
    })
    return bad
  })
  expect(overflow, 'Werte laufen nicht in die Bezeichner').toBe(0)
  await page.getByTestId('cert-sc-detail-close').click()
  await expect(modal).toHaveCount(0)
})
