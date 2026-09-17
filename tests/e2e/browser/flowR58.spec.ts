// R58 Nutzerablauf Ende-zu-Ende: Feld per EINZELKLICK platzieren -> verschieben ->
// signieren -> Signaturen per Kontextmenue (PDF-Fluegel) entfernen -> Platte beweist 0.
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { installBridgeStub, setDialogPaths, setCert } from './bridge'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

let file: string
let p12: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-r58-'))
  file = path.join(dir, 'doc.pdf')
  p12 = path.join(dir, 's.p12')
  await run(py, ['-c', 'import sys, pymupdf; d=pymupdf.open(); p=d.new_page(); p.insert_text((72,120),"FLUSS-TEXT"); d.save(sys.argv[1])', file])
  await run(py, ['-c', `import sys, datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'R58 Fluss')])
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key())
   .serial_number(9).not_valid_before(datetime.datetime.utcnow()-datetime.timedelta(days=1))
   .not_valid_after(datetime.datetime.utcnow()+datetime.timedelta(days=365)).sign(k,hashes.SHA256()))
open(sys.argv[1],'wb').write(pkcs12.serialize_key_and_certificates(b'',k,c,None,serialization.BestAvailableEncryption(b'pw123')))`, p12])
})


async function openP12Section(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click() // R60: Abschnitte sind Standard eingeklappt
  await expect(page.getByTestId('cert-choose')).toBeVisible({ timeout: 4_000 })
}

test('Klick platziert -> Drag verschiebt -> Signatur -> Menue entfernt sie (Platte)', async ({ page }) => {
  test.setTimeout(90_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setCert(page, p12)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  const canvas = page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first()
  await openP12Section(page)

  // 1) EINZELKLICK platziert das Standardfeld (kein Ziehen).
  // Das Feld wird um den Klick-Punkt zentriert -> Klick liegt gezielt auf der Seite.
  const cb = (await canvas.boundingBox())!
  const kx = cb.x + Math.min(320, cb.width * 0.4)
  const ky = Math.max(120, Math.min(cb.y + cb.height * 0.5, 620))
  await page.getByTestId('cert-field-arm').click()
  await page.mouse.click(kx, ky)
  await page.waitForTimeout(400)
  await expect(page.getByTestId('sigfield-1')).toBeVisible({ timeout: 4_000 })
  const r1 = (await page.getByTestId('sigfield-1').boundingBox())!
  console.log('R1', JSON.stringify(r1), await page.getByTestId('sigfield-1').getAttribute('style'))

  // 2) Feld greifen und verschieben.
  await page.mouse.move(r1.x + r1.width / 2, r1.y + r1.height / 2)
  await page.mouse.down()
  await page.mouse.move(r1.x + r1.width / 2 + 60, r1.y + r1.height / 2 + 40, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const r2 = (await page.getByTestId('sigfield-1').boundingBox())!
  console.log('R2', JSON.stringify(r2), await page.getByTestId('sigfield-1').getAttribute('style'))
  expect(Math.abs(r2.x - r1.x)).toBeGreaterThan(20)
  expect(Math.abs(r2.y - r1.y)).toBeGreaterThan(10)

  // 3) Signieren mit Plaintext-P12 (Passwort inline geprueft, kein PIN-Fenster noetig).
  await page.getByTestId('cert-choose').click()
  await expect(page.getByTestId('cert-path')).not.toHaveValue('', { timeout: 5_000 })
  await page.getByTestId('cert-pw').fill('pw123')
  await page.getByTestId('cert-describe').click()
  const signBtn = page.getByTestId('cert-sign')
  await expect(signBtn).toBeEnabled({ timeout: 10_000 })
  await signBtn.click()
  await expect(page.getByTestId('sigfield-1')).toHaveCount(0, { timeout: 20_000 })
  await page.getByTestId('btn-save').click()
  const okBtn = page.getByTestId('confirm-ok')
  if (await okBtn.isVisible().catch(() => false)) await okBtn.click()
  await page.waitForTimeout(900)

  // Signatur muss auf der Platte sein: die BACKEND-Arbeitskopie (echte Bytes,
  // die auch dem Nutzer gezeigt werden) wird als Zweitdatei gepriescht.
  const dump = async (): Promise<string> => {
    const resp = await fetch(`${BACKEND}/document/file`, { headers: { 'X-Auth-Token': TOKEN } })
    if (!resp.ok) throw new Error('file ' + resp.status)
    const buf = Buffer.from(await resp.arrayBuffer())
    const tmp = path.join(os.tmpdir(), `r58-${Date.now()}.pdf`)
    fs.writeFileSync(tmp, buf)
    return tmp
  }
  const countSigs = async (): Promise<number> => {
    const tmp = await dump()
    try {
      const r = await run(py, ['-c', `import sys, pymupdf
d=pymupdf.open(sys.argv[1]); print(len([w for p in d for w in (p.widgets() or []) if (w.field_type_string or '').lower().startswith('sig')]))`, tmp])
      return Number(r.stdout.trim())
    } finally { fs.unlinkSync(tmp) }
  }
  await page.waitForTimeout(600)
  const before = await countSigs()
  expect(before, 'Signatur musste auf der Platte landen').toBe(1)

  // 4) Rechtsklick -> PDF-Fluegel -> 'Digitale Signaturen entfernen'.
  const b = (await canvas.boundingBox())!
  await page.mouse.click(b.x + b.width / 2, b.y + 200, { button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByTestId('ctx-group-grp.pdf').click()
  const rm = menu.getByTestId('ctx-pg-remove-sigs')
  await expect(rm, 'Menuepunkt nur bei signiertem Dokument').toBeVisible()
  await rm.click()

  // 5) Platte: keine Signatur mehr, Text unangetastet.
  await expect.poll(async () => countSigs(), { timeout: 20_000 }).toBe(0)
  const txt = await run(py, ['-c', 'import sys, pymupdf; d=pymupdf.open(sys.argv[1]); print(d[0].get_text())', file])
  expect(txt.stdout).toContain('FLUSS-TEXT')
})
