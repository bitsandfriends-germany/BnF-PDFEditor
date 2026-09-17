// Signaturfeld frei platzierbar/entfernbar/verschiebbar + Aussehen im Dokument
// (Nutzerwunsch R55). Signiert wird mit einem frischen Test-p12 (nicht die Karte).
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

let file: string, p12: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-sf-'))
  file = path.join(dir, 'doc.pdf')
  p12 = path.join(dir, 's.p12')
  await run(py, ['-c', `import sys, pymupdf
d=pymupdf.open(); p=d.new_page()
p.insert_text((72,120),'MARK-P1',fontsize=24)
d.save(sys.argv[1])`, file])
  await run(py, ['-c', `import sys, datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'E2E Testperson')])
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key())
   .serial_number(5).not_valid_before(datetime.datetime.utcnow()-datetime.timedelta(days=1))
   .not_valid_after(datetime.datetime.utcnow()+datetime.timedelta(days=365)).sign(k,hashes.SHA256()))
open(sys.argv[1],'wb').write(pkcs12.serialize_key_and_certificates(b'',k,c,None,serialization.BestAvailableEncryption(b'pw123')))`, p12])
})

async function drawRegion(page: import('@playwright/test').Page, x1: number, y1: number, x2: number, y2: number) {
  const canvas = page.locator('canvas[aria-label="Seite 1"]')
  const b = (await canvas.boundingBox())!
  await page.mouse.move(b.x + x1, b.y + y1)
  await page.mouse.down()
  await page.mouse.move(b.x + x2, b.y + y2, { steps: 8 })
  await page.mouse.up()
}


async function openP12Section(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click() // R60: Abschnitte sind Standard eingeklappt
  await expect(page.getByTestId('cert-choose')).toBeVisible({ timeout: 4_000 })
}

test('Feld platzieren -> entfernen; erneut platzieren -> verschieben -> signieren: Rect auf Platte', async ({ page }) => {
  test.setTimeout(90_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setCert(page, p12)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await openP12Section(page)

  // 1) Platzierungsmodus an -> Region aufziehen -> Overlay erscheint
  await page.getByTestId('cert-field-arm').click()
  await drawRegion(page, 120, 420, 330, 500)
  // kurzes Nachjustieren: Draw-Overlay braucht ggf. einen zweiten Zug (Probe-verifiziert)
  if (await page.getByTestId('cert-field-info').count() === 0) {
    await drawRegion(page, 120, 420, 330, 500)
  }
  await expect(page.getByTestId('sigfield-1')).toBeVisible()
  await expect(page.getByTestId('cert-field-info')).toContainText(/page 1|Seite 1/)

  // 2) Entfernen uebers Panel "entfernen" (robuster als der -top-2 X-Knopf)
  await page.getByTestId('cert-field-clear').click()
  await expect(page.getByTestId('sigfield-1')).toHaveCount(0)

  // 3) Neu platzieren (arm erneut) und per Drag verschieben (+90px, +50px runter)
  await page.getByTestId('cert-field-arm').click()
  await drawRegion(page, 120, 420, 330, 500)
  const ov = page.getByTestId('sigfield-1')
  await expect(ov).toBeVisible()
  const before = (await ov.boundingBox())!
  // Drag von MITTEN im Feld (nahe am X-Knopf wuerde Loeschen statt Ziehen).
  const cx = before.x + before.width / 2
  const cy = before.y + before.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 90, cy + 50, { steps: 6 })
  await page.mouse.up()
  const after = (await ov.boundingBox())!
  expect(Math.abs(after.x - before.x - 90)).toBeLessThan(6)
  expect(Math.abs(after.y - before.y - 50)).toBeLessThan(6)

  // 3b) Groessen-Anfasser: SE-Ecke zieht -> Feld wird breiter und hoeher.
  const se = page.getByTestId('sigfield-resize-se')
  const sb = (await se.boundingBox())!
  const sizeBefore = (await ov.boundingBox())!
  await page.mouse.move(sb.x + 4, sb.y + 4)
  await page.mouse.down()
  await page.mouse.move(sb.x + 44, sb.y + 24, { steps: 5 })
  await page.mouse.up()
  const sizeAfter = (await ov.boundingBox())!
  expect(sizeAfter.width).toBeGreaterThan(sizeBefore.width + 25)
  expect(sizeAfter.height).toBeGreaterThan(sizeBefore.height + 10)

  // 4) p12-Pfad setzen + signieren -> verschieben ist danach nicht mehr moeglich,
  //    das Feld sitzt am verschobenen Rechteck im Dokument.
  await page.getByTestId('cert-choose').click()
  await page.getByTestId('cert-pw').fill('pw123')
  await page.getByTestId('cert-describe').click()
  await expect(page.getByTestId('cert-sign')).toBeEnabled({ timeout: 15_000 })
  await page.getByTestId('cert-sign').click()
  await expect(page.getByTestId('sigfield-1')).toHaveCount(0, { timeout: 20_000 })

  // 5) Speichern -> Behauptungen auf der PLATTENDATEI (Zweitbibliothek pikepdf):
  //    Sig-Annotation existiert, AP (Aussehen) vorhanden, Feldgroesse plausibel.
  await page.getByTestId('btn-save').click()
  // Signiertes Dokument: Speichern verlangt explizite Bestaetigung (Signatur-Gate S2.8).
  const okBtn = page.getByTestId('confirm-ok')
  if (await okBtn.isVisible().catch(() => false)) await okBtn.click()
  await expect(page.getByTestId('btn-save')).toBeEnabled({ timeout: 20_000 })
  const check = await run(py, ['-c', `import sys, pikepdf
doc = pikepdf.open(sys.argv[1])
sig = None
for pg in doc.pages:
    for a in (pg.get("/Annots") or []):
        aa = a
        ft = (aa.get("/FT") or (aa["/Parent"].get("/FT") if aa.get("/Parent") else None))
        if ft == pikepdf.Name("/Sig"):
            sig = aa
assert sig is not None, "keine Sig-Annotation"
assert "/AP" in sig or (sig.get("/Parent") and "/AP" in sig["/Parent"]), "AP (Aussehen) fehlt"
r = [float(v) for v in sig["/Rect"]]
assert r[2] - r[0] > 50 and r[3] - r[1] > 20, f"Feldmasze {r}"
# AP enthaelt den Signaturtext (Nachweis: Aussehen mit Inhalt, nicht leer).
def _streams(obj, depth=0):
    out = []
    if depth > 4 or obj is None: return out
    try:
        obj.read_bytes()
    except Exception:
        pass
    else:
        try: out.append(obj.read_bytes())
        except Exception: pass
    try:
        keys = list(obj.keys())
    except Exception:
        keys = []
    for k in keys:
        try:
            out += _streams(obj[k], depth + 1)
        except Exception:
            pass
    return out
ap_root = sig.get("/AP") or sig["/AP"]
if ap_root is None and sig.get("/Parent") is not None:
    ap_root = sig["/Parent"].get("/AP")
assert ap_root is not None, "AP fehlt"
data = b"".join(_streams(ap_root))
# R66 Vertrag: Der Signaturwert-Wortlaut steht NICHT mehr als Textoperator im
# AP (Adobe: 'DOCUMENT CHANGED AFTER SAVING'). Nachweis des Gefuelltseins:
# Bild-XObject (rasterter Wortlaut) ODER Text im AP (Wieder-Signatur-Pfad).
has_image = b"/SigArt" in data or b"/Subtype /Image" in data or b"/Image" in data
has_text = b"Digitale" in data or b"Signatur" in data
assert has_image or has_text, "AP ohne Signatur-Aussehen (weder Bild noch Text)"
print("OK", [round(v) for v in r])`, file])
  expect(check.stdout).toContain('OK')

  // 6) Kryptografische Gueltigkeit ueber den echten Backend-Pfad.
  const sigs = await (await fetch(`${BACKEND}/document/signatures`, { headers: { 'X-Auth-Token': TOKEN } })).json()
  // Selbstsigniertes Test-p12: Integritaet ja, Vertrauenspfad nein (erwartet).
  expect(sigs.signatures[0].intact).toBe(true)
})
