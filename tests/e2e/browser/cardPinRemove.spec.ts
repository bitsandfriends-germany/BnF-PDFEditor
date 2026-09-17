// R59: PIN2-only-Dialog (ein Feld) + geloesstes Feld ist WIRKLICH weg.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-r59-'))
  file = path.join(dir, 'doc.pdf')
  await run(py, ['-c', 'import sys, pymupdf; d=pymupdf.open(); d.new_page(); d.save(sys.argv[1])', file])
})


async function openP12Section(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click() // R60: Abschnitte sind Standard eingeklappt
  await expect(page.getByTestId('cert-choose')).toBeVisible({ timeout: 4_000 })
}

test('Feld per Klick platzieren und per Button ENTFERNEN (kartenfrei)', async ({ page }) => {
  test.setTimeout(90_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await openP12Section(page)
  await page.getByTestId('cert-field-arm').click()
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(cb.x + Math.min(300, cb.width / 2), Math.max(140, Math.min(cb.y + cb.height * 0.5, 600)))
  await expect(page.getByTestId('sigfield-1')).toBeVisible({ timeout: 4_000 })
  await page.getByTestId('cert-field-clear').click()
  await expect(page.getByTestId('sigfield-1')).toHaveCount(0)
  await expect(page.getByTestId('cert-field-clear')).toHaveCount(0)
})

test('Karten-Signierdialog: nur EIN PIN-Feld (PIN2), kein SigPin-Feld', async ({ page }) => {
  test.setTimeout(120_000)
  let hasCard = false
  for (const wait of [0, 500, 1000, 2000, 4000, 6000]) {
    if (wait) await new Promise((res) => setTimeout(res, wait))
    try {
      const r = await fetch(`${BACKEND}/pkcs11/devices`, { headers: { 'X-Auth-Token': TOKEN } })
      hasCard = ((await r.json()).devices ?? []).length > 0
    } catch { hasCard = false }
    if (hasCard) break
  }
  test.skip(!hasCard, 'keine Karte im Leser')
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-sc').click()
  // 2) Karten-Signierdialog:
  await page.getByTestId('cert-sc-load').click()
  const dev = page.getByTestId('cert-sc-device')
  // R64: Das Geraeteload endet erst, wenn die Optionsliste GEWACHSEN ist —
  // sonst erwischt man die Auswahl genau zwischen zwei Reader-Polls (Skip-Flattern
  // im vollen Suite-Lauf).
  await expect(async () => {
    const c = await dev.locator('option').count()
    expect(c, 'mindestens ein Kartengeraet').toBeGreaterThan(0)
  }, { timeout: 15_000 }).toPass()
  const n = await dev.locator('option').count()
  let chosen = false
  // R64: Nach dem Geraetewechsel kann das Zertifikat-Laden kurz bentigt werden —
  // einmalig warten statt sofort weiterwischen (flatterfreies Skip-Verhalten).
  for (let i = 0; i < n && !chosen; i++) {
    await dev.selectOption({ index: i })
    await expect(async () => {
      const cert = page.locator('[data-testid^="cert-sc-cert-"]')
      expect(await cert.count(), 'Zertifikat lesbar').toBeGreaterThan(0)
    }, { timeout: 6_000, intervals: [400] }).toPass().then(() => { chosen = true }).catch(() => undefined)
    if (chosen) {
      const cert = page.locator('[data-testid^="cert-sc-cert-"]')
      await cert.first().click()
    }
  }
  test.skip(!chosen, 'kein Zertifikat lesbar')
  await page.getByTestId('cert-sc-sign').click()
  const cb2 = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(cb2.x + Math.min(300, cb2.width / 2), Math.max(140, Math.min(cb2.y + cb2.height * 0.5, 600)))
  await expect(page.getByTestId('pin-dialog')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('pin-input')).toBeVisible()
  await expect(page.getByTestId('pin-sigpin'), 'nur eine PIN noetig').toHaveCount(0)
  await page.getByTestId('pin-cancel').click()
  await expect(page.getByTestId('pin-dialog')).toHaveCount(0)
})

test('Signieren+Entfernen: Menuepunkt wirkt auf der Datei, ohne die Karte zu nutzen', async ({ page }) => {
  // Deckt denselben Nutzerpfad ab wie der Kartenlauf (PIN wird im App-Dialog getippt);
  // hier mit P12, damit die echte Karte nicht bei jedem CI-Lauf belastet wird.
  test.setTimeout(90_000)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-r59b-'))
  const doc = path.join(dir, 'd.pdf')
  const cert = path.join(dir, 's.p12')
  await run(py, ['-c', 'import sys, pymupdf; d=pymupdf.open(); p=d.new_page(); p.insert_text((72,120),"ENTFERNEN-TEST"); d.save(sys.argv[1])', doc])
  await run(py, ['-c', `import sys, datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'R59 Entfernen')])
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key())
   .serial_number(11).not_valid_before(datetime.datetime.utcnow()-datetime.timedelta(days=1))
   .not_valid_after(datetime.datetime.utcnow()+datetime.timedelta(days=30)).sign(k,hashes.SHA256()))
open(sys.argv[1],'wb').write(pkcs12.serialize_key_and_certificates(b'',k,c,None,serialization.BestAvailableEncryption(b'pw')))`, cert])
  const { setCert } = await import('./bridge')
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, doc)
  await setCert(page, cert)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await openP12Section(page)
  await page.getByTestId('cert-field-arm').click()
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(cb.x + Math.min(300, cb.width / 2), Math.max(140, Math.min(cb.y + cb.height * 0.5, 600)))
  await expect(page.getByTestId('sigfield-1')).toBeVisible({ timeout: 4_000 })
  await page.getByTestId('cert-choose').click()
  await page.getByTestId('cert-pw').fill('pw')
  await page.getByTestId('cert-describe').click()
  await expect(page.getByTestId('cert-sign')).toBeEnabled({ timeout: 10_000 })
  await page.getByTestId('cert-sign').click()
  await expect(page.getByTestId('sigfield-1')).toHaveCount(0, { timeout: 20_000 })
  // Menuepunkt da?
  await page.mouse.click(cb.x + Math.min(300, cb.width / 2), Math.max(140, Math.min(cb.y + 150, 400)), { button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByTestId('ctx-group-grp.pdf').click()
  const rm = menu.getByTestId('ctx-pg-remove-sigs')
  await expect(rm, 'Menuepunkt erscheint nur bei signiertem Dokument').toBeVisible()
  await rm.click()
  // Arbeitskopie (die der Nutzer sieht) muss signaturfrei sein; Undo stellt her.
  await expect.poll(async () => {
    const resp = await fetch(`${BACKEND}/document/file`, { headers: { 'X-Auth-Token': TOKEN } })
    const buf = Buffer.from(await resp.arrayBuffer())
    const tmp = path.join(dir, `chk-${Date.now()}.pdf`)
    fs.writeFileSync(tmp, buf)
    try {
      const r = await run(py, ['-c', `import sys, pymupdf
d=pymupdf.open(sys.argv[1]); print(len([w for p in d for w in (p.widgets() or []) if (w.field_type_string or '').lower().startswith('sig')]))`, tmp])
      return Number(r.stdout.trim())
    } finally { fs.unlinkSync(tmp) }
  }, { timeout: 20_000 }).toBe(0)
})
