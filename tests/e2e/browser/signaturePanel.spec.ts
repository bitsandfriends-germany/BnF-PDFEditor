// §3-Zeile "Digital signature" durch die ECHTE UI: P12 im Zertifikate-Panel waehlen (Stub),
// Passwort, Describe, signieren, Speichern (Strg+S -> Originalpfad).
// Asserts auf der PLATTENDATEI: get_sigflags() signiert, /ByteRange deckt den Gesamtumfang
// (o1==0, o2+l2==size), MARKs + Seitenzahl heil (pymupdf als zweiter Parser).
// TAMPER: echte Aenderung nach der Signatur, ueber den ECHTEN Endpunkt neu geoeffnet ->
// Validierung muss fehlschlagen.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-sig-'))
  file = path.join(dir, 'doc.pdf')
  p12 = path.join(dir, 's.p12')
  await run(py, ['-c',
    `import sys, datetime as dt, pymupdf\nd=pymupdf.open()\nfor i in (1,2):\n p=d.new_page()\n p.insert_text((72,120),'MARK-S%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()\nfrom cryptography import x509\nfrom cryptography.x509.oid import NameOID\nfrom cryptography.hazmat.primitives import hashes, serialization\nfrom cryptography.hazmat.primitives.serialization import pkcs12\nfrom cryptography.hazmat.primitives.asymmetric import rsa\nkey=rsa.generate_private_key(public_exponent=65537,key_size=2048)\nname=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'E2E Signierer')])\ncert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(dt.datetime(2020,1,1)).not_valid_after(dt.datetime(2040,1,1)).sign(key,hashes.SHA256()))\ndata=pkcs12.serialize_key_and_certificates(b'p',key,cert,None,serialization.BestAvailableEncryption(b'pw123'))\nopen(sys.argv[2],'wb').write(data)`,
    file, p12])
})

const PY = `
import sys, pymupdf, re, io
raw=open(sys.argv[1],'rb').read()
d=pymupdf.open('pdf', io.BytesIO(raw))
flags=d.get_sigflags()
signed = flags!=-1 and bool(flags & 1)
m=None
for mm in re.finditer(rb'/ByteRange\\s*\\[\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*\\]', raw):
    m=mm
cover=False
if m:
    o1,l1,o2,l2=[int(x) for x in m.groups()]
    cover = (o1==0 and o2+l2==len(raw))
txt=''.join(pg.get_text() for pg in d)
print(int(signed), cover, 'MARKS' if ('MARK-S1' in txt and 'MARK-S2' in txt) else 'NOMARKS', d.page_count)
`

const PYT = `
import sys, urllib.request, json, pymupdf, io
raw=open(sys.argv[3],'rb').read()
t=pymupdf.open('pdf', io.BytesIO(raw))
t[0].insert_text((72,760),'GEFELSHT',fontsize=18)
open(sys.argv[3]+'.tam','wb').write(t.tobytes())
def req(method, path, body=None):
    r=urllib.request.Request(sys.argv[1]+path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'X-Auth-Token':sys.argv[2],'Content-Type':'application/json'})
    return urllib.request.urlopen(r).read()
req('POST','/document/open',{'path':sys.argv[3]+'.tam'})
sig=json.loads(req('GET','/document/signatures').decode())['signatures']
ok = len(sig)>0 and sig[0]['intact'] and sig[0]['valid']
print('TAMPER-DETECTED' if not ok else 'TAMPER-MISSED')
`


async function openP12Section(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click() // R60: Abschnitte sind Standard eingeklappt
  await expect(page.getByTestId('cert-choose')).toBeVisible({ timeout: 4_000 })
}

test('Signatur per Panel: gueltig mit vollem ByteRange; Tamper faellt durch', async ({ page }) => {
  test.setTimeout(120_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setCert(page, p12)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })

  await openP12Section(page)
  await page.getByTestId('cert-choose').click()
  await expect(page.getByTestId('cert-path')).not.toHaveValue('', { timeout: 5_000 })
  await page.getByTestId('cert-pw').fill('pw123')
  await page.getByTestId('cert-describe').click()
  await page.waitForTimeout(700)
  const signBtn = page.getByTestId('cert-sign')
  await expect(signBtn).toBeEnabled({ timeout: 10_000 })
  // R58: vor dem Signieren wird das Feld per Klick plaziert.
  await page.getByTestId('cert-field-arm').click()
  const cb2 = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(cb2.x + Math.min(300, cb2.width / 2), Math.max(140, Math.min(cb2.y + cb2.height * 0.5, 600)))
  await expect(page.getByTestId('sigfield-1')).toBeVisible({ timeout: 4_000 })
  await signBtn.click()
  // pyHanko laeuft Sekunden: die Signatur im Backend-Zustand abwarten (echter Endpunkt),
  // DANN speichern — sonst speichert Strg+S die unsignierte Arbeitskopie (Race aus Lauf 1).
  // (Das Zertifikate-Panel listet nur die Zeichenbibliothek, keine Dokument-Signaturen.)
  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c',
      `import sys, json, urllib.request\nr=urllib.request.Request(sys.argv[1]+"/document/signatures", headers={"X-Auth-Token":sys.argv[2]})\nprint(json.loads(urllib.request.urlopen(r).read())["signatures"].__len__())`,
      BACKEND, TOKEN])
    return parseInt(stdout.trim(), 10)
  }, { timeout: 40_000, intervals: [500, 1000] }).toBe(1)
  await page.keyboard.press('Control+s')

  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY, file])
    return stdout.trim()
  }, { timeout: 40_000, intervals: [1000, 2000] }).toBe('1 True MARKS 2')

  const { stdout } = await run(py, ['-c', PYT, BACKEND, TOKEN, file])
  expect(stdout.trim()).toContain('TAMPER-DETECTED')
})
