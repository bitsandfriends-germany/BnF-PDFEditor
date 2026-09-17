// R60: Nutzergrafik (Unterschrift-PNG) landet SICHTBAR im signierten Feld und
// die Signatur bleibt gueltig — derselbe Backend-Pfad, den die Smartcard nutzt.
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

test('PNG-Grafik im Signaturfeld: Pixel im AP + intakte Signatur + Entfernen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-r60g-'))
  const doc = path.join(dir, 'd.pdf')
  const png = path.join(dir, 'sig.png')
  const p12 = path.join(dir, 's.p12')
  await run(py, ['-c', 'import sys, pymupdf; d=pymupdf.open(); p=d.new_page(); p.insert_text((72,120),"TEXT"); d.save(sys.argv[1])', doc])
  await run(py, ['-c', `import sys, pymupdf
d=pymupdf.open(); p=d.new_page(width=140,height=60); p.insert_text((5,35),'HAND')
d.get_page_pixmap(0,dpi=96).save(sys.argv[1])`, png])
  await run(py, ['-c', `import sys, datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'R60 Grafik')])
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key())
   .serial_number(22).not_valid_before(datetime.datetime.utcnow()-datetime.timedelta(days=1))
   .not_valid_after(datetime.datetime.utcnow()+datetime.timedelta(days=30)).sign(k,hashes.SHA256()))
open(sys.argv[1],'wb').write(pkcs12.serialize_key_and_certificates(b'',k,c,None,serialization.BestAvailableEncryption(b'pw')))`, p12])
  const H = { 'X-Auth-Token': TOKEN, 'content-type': 'application/json' }
  const o = await fetch(`${BACKEND}/document/open`, { method: 'POST', headers: H, body: JSON.stringify({ path: doc }) })
  expect(o.status, await o.text()).toBe(200)
  const r = await fetch(`${BACKEND}/document/sign`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ p12Path: p12, password: 'pw', page: 0, x: 80, y: 60, width: 240, height: 70, name: 'G. Fiker', image: fs.readFileSync(png).toString('base64') })
  })
  expect(r.status, await r.text()).toBe(200)
  const v = await (await fetch(`${BACKEND}/document/signatures`, { headers: H })).json()
  expect(v.signatures[0].intact, 'Signatur bleibt gueltig').toBe(true)
  // Pixel: Feldbereich rendern, nicht-weisse Pixel (Bild vorhanden)?
  const chk = path.join(dir, 'chk.pdf')
  const bytes = await (await fetch(`${BACKEND}/document/file`, { headers: H })).arrayBuffer()
  fs.writeFileSync(chk, Buffer.from(bytes))
  const out = await run(py, ['-c', `import sys, pymupdf, collections
d=pymupdf.open(sys.argv[1])
pg=d[0]; H=pg.rect.height
clip=pymupdf.Rect(82,H-128,318,H-62)
pix=pg.get_pixmap(clip=clip,dpi=144)
c=collections.Counter()
for y in range(0,pix.height,3):
    for x in range(0,pix.width,3):
        c[pix.pixel(x,y)]+=1
nonwhite=sum(v for k,v in c.items() if k!=(255,255,255))
print(nonwhite)`, chk])
  expect(Number(out.stdout.trim()), 'Bildpixel im Signaturfeld').toBeGreaterThan(50)
  const rm = await (await fetch(`${BACKEND}/document/remove-signatures`, { method: 'POST', headers: H })).json()
  expect(rm.removed).toBeGreaterThan(0)
})

test('R63: SVG-Grafik wird zu PNG umgewandelt und persistent gespeichert', async ({ page }) => {
  test.setTimeout(60_000)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-r63-'))
  const svg = path.join(dir, 'u.svg')
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"><path d="M5 60 C40 10 80 65 120 30 S200 25 215 40" stroke="#123" stroke-width="4" fill="none"/></svg>')
  const H = { 'X-Auth-Token': TOKEN, 'content-type': 'application/json' }
  const g = await (await fetch(`${BACKEND}/signature-graphic?path=${encodeURIComponent(svg)}`, { headers: H })).json()
  expect(g.mime, 'SVG kommt als PNG zurueck').toBe('image/png')
  expect(Buffer.from(g.b64, 'base64').subarray(0, 4).toString('hex')).toBe('89504e47')
  // Persistenz-Ueberlebensexemplar: Bridge-Pref gesetzt -> Panel zeigt die Grafik wieder.
  const doc = path.join(dir, 'd.pdf')
  await run(py, ['-c', 'import sys, pymupdf; d=pymupdf.open(); d.new_page(); d.save(sys.argv[1])', doc])
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, doc)
  await page.addInitScript((v) => { (window as unknown as { __E2E_SIGPREF?: unknown }).__E2E_SIGPREF = v }, { path: svg, name: 'u.svg' })
  await page.goto('http://localhost:5199/')
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-sc').click()
  await expect(page.getByTestId('cert-sc-graphic-file'), 'Persistierung: Panel zeigt die letzte Grafik').toContainText('u.svg', { timeout: 8_000 })
})
