// R60: Modus-Toggles, SigField-Werkzeugleiste (Move ueber Feldrand!), Detail-Popup,
// Badge, Grafik-ins-Feld (P12 als Ersatz fuer Card-Pfad, gleicher Backend-Code).
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { installBridgeStub, setDialogPaths, setCert, setGraphic } from './bridge'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

let file: string, p12: string, dir: string
test.beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-r60-'))
  file = path.join(dir, 'doc.pdf')
  p12 = path.join(dir, 's.p12')
  await run(py, ['-c', 'import sys, pymupdf; d=pymupdf.open(); p=d.new_page(); p.insert_text((72,120),"R60"); d.save(sys.argv[1])', file])
  await run(py, ['-c', `import sys, datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'R65 Tester')])
c=(x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key())
   .serial_number(21).not_valid_before(datetime.datetime.utcnow()-datetime.timedelta(days=1))
   .not_valid_after(datetime.datetime.utcnow()+datetime.timedelta(days=30)).sign(k,hashes.SHA256()))
open(sys.argv[1],'wb').write(pkcs12.serialize_key_and_certificates(b'',k,c,None,serialization.BestAvailableEncryption(b'pw')))`, p12])
})

test.beforeEach(async ({ page }) => {
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setCert(page, p12)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
})

test('SigField: Drag ueber den Feldrand hinaus verschiebt weiter; Papierkorb loescht', async ({ page }) => {
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click()
  await page.getByTestId('cert-field-arm').click()
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  const px = cb.x + Math.min(320, cb.width * 0.5)
  const py = Math.max(150, Math.min(cb.y + cb.height * 0.5, 600))
  await page.mouse.click(px, py)
  const sf = page.getByTestId('sigfield-1')
  await expect(sf).toBeVisible()
  const b1 = (await sf.boundingBox())!
  // DRAG weit ueber die rechte Feldkante hinaus (Capture-Fall-Scenario):
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2)
  await page.mouse.down()
  await page.mouse.move(b1.x + b1.width + 90, b1.y + b1.height / 2 - 40, { steps: 12 })
  await page.mouse.up()
  const b2 = (await sf.boundingBox())!
  expect(b2.x - b1.x, 'Feld folgt dem Drag ueber die Kante').toBeGreaterThan(60)
  expect(b1.y - b2.y).toBeGreaterThan(20)
  // Werkzeugleiste mit Papierkorb-Button (Nutzer: wie die anderen Objekte)
  const tb = page.getByTestId('sigfield-toolbar')
  await expect(tb).toBeVisible()
  await expect(page.getByTestId('sigfield-remove'), 'Papierkorb-Button mit Text').toContainText(/Entfernen|Remove/)
  await page.getByTestId('sigfield-remove').click()
  await expect(sf).toHaveCount(0)
})

test('Modi: Hand- und Text-Toggle schalten um und sind als aktiv markiert', async ({ page }) => {
  const hand = page.getByTestId('tb-mode-hand')
  const text = page.getByTestId('tb-mode-text')
  await expect(hand).toBeVisible()
  await hand.click()
  await expect(hand).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('tb-mode-text').click()
  await expect(text).toHaveAttribute('aria-pressed', 'true')
  await expect(hand).toHaveAttribute('aria-pressed', 'false')
  // nochmal Text klicken -> zurueck auf select
  await text.click()
  await expect(text).toHaveAttribute('aria-pressed', 'false')
})

test('Signatur fertig: Badge links unten, Popup mit Urteil; Seitenleisten-Entfernen wirkt', async ({ page }) => {
  test.setTimeout(90_000)
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click()
  await page.getByTestId('cert-field-arm').click()
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(cb.x + Math.min(320, cb.width * 0.5), Math.max(150, Math.min(cb.y + cb.height * 0.5, 600)))
  await expect(page.getByTestId('sigfield-1')).toBeVisible()
  await page.getByTestId('cert-choose').click()
  await page.getByTestId('cert-pw').fill('pw')
  await page.getByTestId('cert-describe').click()
  await expect(page.getByTestId('cert-sign')).toBeEnabled({ timeout: 10_000 })
  await page.getByTestId('cert-sign').click()
  await expect(page.getByTestId('sigfield-1')).toHaveCount(0, { timeout: 20_000 })
  // Badge erscheint, Klick zeigt CA-Urteil
  const badge = page.getByTestId('sig-badge')
  await expect(badge, 'grünes Zertifikatszeichen links unten').toBeVisible()
  await badge.click()
  await expect(page.getByTestId('sig-badge-modal')).toBeVisible()
  await page.getByTestId('sig-badge-close').click()
  // Entfernen JETZT auch in der Signaturen-Seitenleiste
  await page.getByTestId('sidebar-tab-signatures').click()
  await page.getByTestId('sigdoc-remove-all').click()
  await expect(badge).toHaveCount(0, { timeout: 20_000 })
})

test('R64: Klick auf das Signaturobjekt in der Seite oeffnet das Signatur-Info-Popup', async ({ page }) => {
  test.setTimeout(90_000)
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click()
  await page.getByTestId('cert-field-arm').click()
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  const fx = cb.x + Math.min(200, cb.width * 0.35)
  const fy = Math.max(150, Math.min(cb.y + cb.height * 0.4, 500))
  await page.mouse.click(fx, fy)
  await expect(page.getByTestId('sigfield-1')).toBeVisible()
  await page.getByTestId('cert-choose').click()
  await page.getByTestId('cert-pw').fill('pw')
  await page.getByTestId('cert-describe').click()
  await expect(page.getByTestId('cert-sign')).toBeEnabled({ timeout: 10_000 })
  await page.getByTestId('cert-sign').click()
  await expect(page.getByTestId('sig-badge')).toBeVisible({ timeout: 30_000 })
  // Das Platzhalter-Overlay ist weg — das Feld ist jetzt ein PDF-Objekt.
  await expect(page.getByTestId('sigfield-1')).toHaveCount(0)
  // Klick INS Feld (PDF-Objekt) -> Info-Popup mit Urteil.
  await page.mouse.click(fx, fy)
  const pop = page.getByTestId('sigfield-info')
  await expect(pop).toBeVisible()
  await expect(page.getByTestId('sigfield-info-verdict')).toContainText(/g(u|ü|ue)ltig|valid|Signatur/i, { timeout: 15_000 })
  await page.getByTestId('sigfield-info-close').click()
  await expect(pop).toHaveCount(0)
})

test('R65: signiertes Feld zeigt Bild+Name+Zeit im Feldtext; Formularpanel zeigt kein SIGN-Eingabefeld', async ({ page }) => {
  test.setTimeout(120_000)
  // R68: bunte Bibliotheks-Grafik (koenigsblau, alpha) zuerst im Backend anlegen —
  // der Nutzerbefund war "Grafik nicht sichtbar", aber Rand+Siegel erfuellten die
  // alten Nichtweiss-Assertions. Ab jetzt muss die GRAFIK selbst farbig messbar sein.
  const gpng = path.join(dir, 'blue-sig.png')
  await run(py, ['-c', `import sys, pymupdf
d=pymupdf.open(); p=d.new_page(width=220,height=70)
p.draw_rect(pymupdf.Rect(8,8,212,62), color=(0.04,0.35,0.94), fill=(0.04,0.35,0.94), width=2)
p.draw_circle((60,35),14, color=(1,1,1), fill=(1,1,1), width=1)
open(sys.argv[1],'wb').write(p.get_pixmap(alpha=True).tobytes('png'))`, gpng])
  const imp = await (await fetch(`${BACKEND}/signatures/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN },
    body: JSON.stringify({ name: 'E2E Blau', image: fs.readFileSync(gpng).toString('base64'), ext: '.png', sizePt: 200, opacity: 1 })
  })).json()
  const graphicId = imp.id as string
  expect(graphicId, 'Grafik im Signatur-Store angelegt').toBeTruthy()
  // Panel-Neuaufbau, damit die Bibliotheks-Liste den neuen Eintrag hat:
  await setCert(page, p12)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click()
  await page.getByTestId('cert-field-arm').click()
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  const fx = cb.x + Math.min(200, cb.width * 0.35)
  const fy = Math.max(150, Math.min(cb.y + cb.height * 0.4, 500))
  await page.mouse.click(fx, fy)
  await expect(page.getByTestId('sigfield-1')).toBeVisible()
  const sf = (await page.getByTestId('sigfield-1').boundingBox())!
  await page.getByTestId('cert-choose').click()
  await page.getByTestId('cert-pw').fill('pw')
  await page.getByTestId('cert-describe').click()
  await expect(page.getByTestId('cert-sign')).toBeEnabled({ timeout: 10_000 })
  // R65 Nutzer: Der Zert-CN wird nach dem Beschreiben VORBELEGET — der Nutzer
  // sieht ihn, bevor er signiert, und er landet im Feld.
  await expect(page.getByTestId('cert-sign-name'), 'CN vorbelegt').toHaveValue(/Tester/, { timeout: 5_000 })
  // R68: bunte Bibliotheks-Grafik (koenigsblau) auswaehlen — der Nutzerbefund
  // war: Grafik im Feld unsichtbar, aber dunkler Rand+Siegel erfulelten die
  // Nichtweiss-Assertionen. Ab jetzt muss die GRAFIK farbig nachweisbar sein.
  await page.getByTestId('cert-sign-graphic').selectOption(graphicId)
  await page.getByTestId('cert-sign-name').fill('E2E Signatur')
  await page.getByTestId('cert-sign-reason').fill('R65 Grund')
  await page.getByTestId('cert-sign').click()
  await expect(page.getByTestId('sig-badge')).toBeVisible({ timeout: 30_000 })
  // Warten bis die Datei auf der Platte den Signaturtext traegt — der Viewer
  // zeigt erst das Platzhalter-Overlay, der Backend-Schreiblauf braucht kurz.
  await expect(async () => {
    const ab = await (await fetch(`${BACKEND}/document/file`, { headers: { 'X-Auth-Token': TOKEN } })).arrayBuffer()
    const tmp = path.join(dir, 'poll.pdf')
    fs.writeFileSync(tmp, Buffer.from(ab))
    const o = await run(py, ['-c', 'import sys,pymupdf;d=pymupdf.open(sys.argv[1]);print(len(list(d[0].widgets() or [])))', tmp])
    expect(o.stdout.trim()).toBe('1')
  }, { timeout: 30_000, intervals: [1500] }).toPass()
  // (a) Der WIRKLICHE Feldinhalt (AP-Stream) auf der Datei enthaelt den
  // Signaturtext — Bild wird separat als Nichtweiss-Pixel gemessen.
  const info = await (await fetch(`${BACKEND}/document/file`, { headers: { 'X-Auth-Token': TOKEN } })).arrayBuffer()
  const chk = path.join(os.tmpdir(), `r65-ap-${Date.now()}.pdf`)
  fs.writeFileSync(chk, Buffer.from(info))
  const out = await run(py, ['-c', `import sys, pymupdf, base64, collections, re
d=pymupdf.open(sys.argv[1]); pg=d[0]
def ap_text(pg):
    out=[]
    for wd in pg.widgets() or []:
        kind, ap = d.xref_get_key(wd.xref,'AP')
        m=re.search(r'/N (\\d+) 0 R', ap or '')
        if not m: continue
        data=d.xref_stream(int(m.group(1))).decode('latin-1')
        out += [mm.group(1).replace(chr(92)+'(','(').replace(chr(92)+')',')') for mm in re.finditer(r'\\((.*?)\\) Tj', data)]
    return ' '.join(out)
r=[w for w in (pg.widgets() or []) if w.field_type_string=='Signature'][0]
pix=pg.get_pixmap(clip=r.rect,dpi=144)
c=collections.Counter()
for y in range(0,pix.height,2):
    for x in range(0,pix.width,2): c[pix.pixel(x,y)]+=1
np=sum(v for k,v in c.items() if k!=(255,255,255))
cf=0
for y in range(0,pix.height,2):
    for x in range(0,pix.width,2):
        q=pix.pixel(x,y)
        if q[2]-q[0]>90: cf+=1
r=d[0].get_pixmap(clip=r.rect,dpi=192)
dr=0
for y in range(r.height):
    for x in range(r.width//2, r.width):
        px=r.pixel(x,y)
        if sum(px)<400: dr+=1
t=ap_text(pg)
print(base64.b64encode(t.encode()).decode()+'|'+str(np)+'|'+str(dr)+'|'+str(cf))`, chk])
  const [txtB64, npS, drS, cfS] = out.stdout.trim().split('|')
  const fieldText = Buffer.from(txtB64, 'base64').toString('utf-8')
  // R66 NEUER VERTRAG: Der Signaturwert-Wortlaut steht NICHT im AP-Strom
  // (sonst meldet Adobe 'DOCUMENT CHANGED AFTER SAVING' — gemessen Stufe
  // FORM_FILLING). Name/Zeit sind INS Bild gerastert und als dunkle
  // Textpixel der rechten Haelfte sichtbar; der Wortlaut lebt im Popup.
  expect(fieldText, 'AP darf keinen Wert-Wortlaut tragen').toBe('')
  expect(Number(npS), 'Bildgrafik im Feld').toBeGreaterThan(120)
  expect(Number(drS), 'Name/Zeit als Pixel im Feld sichtbar').toBeGreaterThan(150)
  // R68 NUTZERBEFUND: die gewaehlte Grafik muss FARBIG im Feld stehen —
  // dunkler Rand+Siegel allein duerfen den Test nicht mehr bestehen.
  expect(Number(cfS), 'blaue Grafik-Pixel im signierten Feld').toBeGreaterThan(1200)
  // Wortlaut im Popup (Signatur-JSON): Name + Signaturzeit vorhanden.
  const sigs = await (await fetch(`${BACKEND}/document/signatures`, { headers: { 'X-Auth-Token': TOKEN } })).json()
  expect(sigs.signatures[0].name ?? '', 'Name im Signatur-Datensatz').toMatch(/E2E Signatur/)
  expect(sigs.signatures[0].signTime, 'Signaturzeit im Datensatz').toBeTruthy()
  // (c) R66 NUTZERBEFUND: DasCanvas des VIEWERS muss das Aussehen zeigen —
  // frueher blieb das unterzeichnete Feld im Viewer leer (pdfjs zeichnet
  // Signatur-APs nur im print-Intent). Wir schneiden das Feldrechteck aus dem
  // Viewer-Canvas und zaehlen Nichtweiss-Pixel.
  const fieldShot = path.join(dir, `viewer-field-${Date.now()}.png`)
  const cvEl = page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first()
  const cvBox = (await cvEl.boundingBox())!
  const clip = {
    x: cvBox.x + Math.max(0, sf.x - cvBox.x) - 2,
    y: cvBox.y + Math.max(0, sf.y - cvBox.y) - 2,
    width: Math.min(sf.width + 4, cvBox.width),
    height: Math.min(sf.height + 4, cvBox.height)
  }
  await cvEl.screenshot({ path: fieldShot, clip })
  const nonwhite = await run(py, ['-c', `import sys, collections, pymupdf
pix=pymupdf.Pixmap(sys.argv[1])
c=collections.Counter()
for y in range(pix.height):
    for x in range(pix.width): c[pix.pixel(x,y)]+=1
print(sum(v for k,v in c.items() if k!=(255,255,255)))`, fieldShot])
  expect(Number(nonwhite.stdout.trim()), 'Viewer-Canvas zeigt Bild+Text im Feld').toBeGreaterThan(250)
  // (b) Formularpanel: das Signaturfeld ist nicht mehr als editierbares Feld da.
  await page.getByTestId('sidebar-tab-forms').click()
  await expect(page.getByTestId('form-count')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('form-count')).toContainText(/1/)
  await expect(page.locator('input[name="Signature1"], textarea[name="Signature1"]')).toHaveCount(0)
  // Kein SIGN-Feld mehr als Textfeld (nur noch untesrzeichnetes Sig-Feld, ohne Eingabe)
  await expect(page.locator('#form-editor input, #form-editor textarea, #form-editor select')).toHaveCount(0)
})

test('R65: Karten-Signierpfad MIT gewaehlter Grafik (Echt-PKCS11) — Feld zeigt alles, Status gut', async ({ page }) => {
  const rd = await fetch(`${BACKEND}/pkcs11/devices`, { headers: { 'X-Auth-Token': TOKEN } })
  const hasCard = ((await rd.json()).devices ?? []).length > 0
  test.skip(!hasCard, 'keine Karte im Leser')
  // R68: Echtkarten-Signatur NUR bei ausdruecklichem_env — ein eingebauter
  // PIN-Fallback loesst unbeabsichtigt echte Kartensignaturen (R67/voll-Run).
  const CARD_PIN = process.env['BFTEST_PIN'] ?? ''
  test.skip(!CARD_PIN, 'BFTEST_PIN nicht gesetzt — Echtkartenlauf bewusst aus')
  test.setTimeout(120_000)
  const svg = path.join(dir, 'u-sig.svg')
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"><path d="M5 60 C40 10 80 65 120 30 S200 25 215 40" stroke="#0a58ef" stroke-width="6" fill="none"/></svg>')
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setGraphic(page, svg)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-sc').click()
  // R65: Die Grafik wird VOR Geraeteladen gewaehlt — ihre Zeile ist unabhaengig
  // von Karten im Leser, und die Auswahl ist dasselbe Bild wie im echten Ablauf.
  // (Klick hier nicht zweimaechtig: zweiter Klick wuerde die Auswahl loeschen.)
  await page.getByTestId('cert-sc-graphic-file').click()
  await expect(page.getByTestId('cert-sc-graphic-file'), 'Grafik im Panel gewaehlt').toContainText('u-sig.svg', { timeout: 10_000 })
  await page.getByTestId('cert-sc-load').click()
  const dev = page.getByTestId('cert-sc-device')
  await expect(async () => { expect(await dev.locator('option').count()).toBeGreaterThan(0) }, { timeout: 15_000 }).toPass()
  const n = await dev.locator('option').count()
  let chosen = false
  for (let i = 0; i < n && !chosen; i++) {
    await dev.selectOption({ index: i })
    await expect(async () => {
      expect(await page.locator('[data-testid^="cert-sc-cert-"]').count()).toBeGreaterThan(0)
    }, { timeout: 6_000, intervals: [400] }).toPass().then(() => { chosen = true }).catch(() => undefined)
    if (chosen) await page.locator('[data-testid^="cert-sc-cert-"]').first().click()
  }
  expect(chosen, 'Signaturzertifikat lesbar').toBe(true)
  // Feld platzieren (R58-Klickmodus, Feld liegt IM P12-Abschnitt), dann
  // Karten-Signatur mit PIN2.
  await page.getByTestId('cert-sec-p12').click()
  await expect(page.getByTestId('cert-field-arm')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('cert-field-arm').click()
  await page.getByTestId('cert-sec-p12').click()
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  await page.mouse.click(cb.x + Math.min(300, cb.width / 2), Math.max(140, Math.min(cb.y + cb.height * 0.5, 600)))
  await expect(page.getByTestId('sigfield-1')).toBeVisible()
  await page.getByTestId('cert-sc-sign').click()
  await expect(page.getByTestId('pin-dialog')).toBeVisible({ timeout: 8_000 })
  await page.getByTestId('pin-input').fill(CARD_PIN)
  await page.getByTestId('pin-ok').click()
  await expect(page.getByTestId('sig-badge'), 'Badge nach Karten-Signatur').toBeVisible({ timeout: 45_000 })
  // Datei auf der Platte: Status gut + Feldtext (Name/Zeit) + Bildpixel.
  const info = await (await fetch(`${BACKEND}/document/file`, { headers: { 'X-Auth-Token': TOKEN } })).arrayBuffer()
  const chk = path.join(dir, 'cardsigned.pdf')
  fs.writeFileSync(chk, Buffer.from(info))
  const out = await run(py, ['-c', `import sys, pymupdf, base64, collections, re
d=pymupdf.open(sys.argv[1]); pg=d[0]
def ap_text(pg):
    out=[]
    for wd in pg.widgets() or []:
        kind, ap = d.xref_get_key(wd.xref,'AP')
        m=re.search(r'/N (\\d+) 0 R', ap or '')
        if not m: continue
        data=d.xref_stream(int(m.group(1))).decode('latin-1')
        out += [mm.group(1).replace(chr(92)+'(','(').replace(chr(92)+')',')') for mm in re.finditer(r'\\((.*?)\\) Tj', data)]
    return ' '.join(out)
r=[w for w in (pg.widgets() or []) if w.field_type_string=='Signature'][0]
pix=pg.get_pixmap(clip=r.rect,dpi=144)
c=collections.Counter()
for y in range(0,pix.height,2):
    for x in range(0,pix.width,2): c[pix.pixel(x,y)]+=1
np=sum(v for k,v in c.items() if k!=(255,255,255))
cf=0
for y in range(0,pix.height,2):
    for x in range(0,pix.width,2):
        q=pix.pixel(x,y)
        if q[2]-q[0]>90: cf+=1
r=d[0].get_pixmap(clip=r.rect,dpi=192)
dr=0
for y in range(r.height):
    for x in range(r.width//2, r.width):
        px=r.pixel(x,y)
        if sum(px)<400: dr+=1
t=ap_text(pg)
print(base64.b64encode(t.encode()).decode()+'|'+str(np)+'|'+str(dr)+'|'+str(cf))`, chk])
  const [txtB64, npS, drS, cfS] = out.stdout.trim().split('|')
  const fieldText = Buffer.from(txtB64, 'base64').toString('utf-8')
  expect(fieldText, 'AP traegt keinen Wert-Wortlaut').toBe('')
  expect(Number(npS), 'Unterschriften-Grafik im Feld').toBeGreaterThan(150)
  expect(Number(cfS), 'R68: blaue Unterschriften-Pixel im Kartenfeld').toBeGreaterThan(120)
  expect(Number(drS), 'Name/Zeit als Pixel im Kartenfeld sichtbar').toBeGreaterThan(120)
  // Kartenname (CN-Vorfuellung) im Signatur-Datensatz.
  const sigs2 = await (await fetch(`${BACKEND}/document/signatures`, { headers: { 'X-Auth-Token': TOKEN } })).json()
  expect((sigs2.signatures[0].name ?? '') + (sigs2.signatures[0].signerCn ?? ''), 'Karteninhaber im Datensatz').toMatch(/BARTH/i)
  // Urteil im Badge-Popup.
  await page.getByTestId('sig-badge').click()
  await expect(page.getByTestId('sig-badge-item-0')).toContainText(/gültig|valid|Gueltig/i)
  await page.getByTestId('sig-badge-close').click()
  // Entfernen wirkt (Gate-Bestaetigung annehmen).
  await page.getByTestId('sidebar-tab-signatures').click()
  page.once('dialog', () => undefined)
  await page.getByTestId('sigdoc-remove-all').click()
  await expect(page.getByTestId('sigdoc-empty')).toBeVisible({ timeout: 15_000 })
})

test('R67: Importierter Vertrauensanker macht die Signatur "CA trusted: yes" (UI + echte HTTP-Pfade)', async ({ page }) => {
  test.setTimeout(120_000)
  // Ketten-Fixtur: CA + Blatt (p12 OHNE eingebettete CA — wie die estnische Karte,
  // deren Ketten-Wurzel der lokale Store nicht kennt; Adobe bringt sie mit).
  const chainP12 = path.join(dir, 'chain.p12')
  const caPem = path.join(dir, 'ca.pem')
  await run(py, ['-c', `import sys, datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
ca_k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
ca_n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'R67 E2E Root')])
now=datetime.datetime.now(datetime.timezone.utc)
ca=(x509.CertificateBuilder().subject_name(ca_n).issuer_name(ca_n).public_key(ca_k.public_key())
    .serial_number(67101).not_valid_before(now-datetime.timedelta(days=1))
    .not_valid_after(now+datetime.timedelta(days=3650))
    .add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).sign(ca_k,hashes.SHA256()))
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'R67 Karten Inhaber')])
leaf=(x509.CertificateBuilder().subject_name(n).issuer_name(ca_n).public_key(k.public_key())
      .serial_number(67102).not_valid_before(now-datetime.timedelta(days=1))
      .not_valid_after(now+datetime.timedelta(days=365)).sign(ca_k,hashes.SHA256()))
open(sys.argv[1],'wb').write(pkcs12.serialize_key_and_certificates(b'',k,leaf,None,serialization.BestAvailableEncryption(b'pw')))
open(sys.argv[2],'wb').write(ca.public_bytes(serialization.Encoding.PEM))`, chainP12, caPem])
  // NEU LADEN: das Init-Script des beforeEach pflanzt den Shared-Pfad erst beim
  // naechsten Dokument-Load ein — ohne Reload wuerde die Shared-R65-Kette
  // signiert und der importierte Anker ins Leere zeigen.
  await setCert(page, chainP12)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  await page.getByTestId('sidebar-tab-certificates').click()
  await page.getByTestId('cert-sec-p12').click()
  await page.getByTestId('cert-field-arm').click()
  const cb = (await page.locator('canvas[aria-label="Seite 1"], canvas[aria-label="Page 1"]').first().boundingBox())!
  const fx = cb.x + Math.min(200, cb.width * 0.35)
  const fy = Math.max(150, Math.min(cb.y + cb.height * 0.4, 500))
  await page.mouse.click(fx, fy)
  await expect(page.getByTestId('sigfield-1')).toBeVisible()
  await page.getByTestId('cert-choose').click()
  await page.getByTestId('cert-pw').fill('pw')
  await page.getByTestId('cert-describe').click()
  await expect(page.getByTestId('cert-sign')).toBeEnabled({ timeout: 10_000 })
  await page.getByTestId('cert-sign').click()
  await expect(page.getByTestId('sig-badge')).toBeVisible({ timeout: 30_000 })

  // 1) OHNE Anker: Pruef-Daten (echt HTTP) sagen trusted=False, und das
  //    Feld-Popup erklaert die fehlende Wurzel mit der Ketten-Note.
  const before = await (await fetch(`${BACKEND}/document/signatures`, { headers: { 'X-Auth-Token': TOKEN } })).json()
  expect(before.signatures[0].trusted, 'ohne Anker: nicht trusted').toBe(false)
  expect(before.signatures[0].trustNote, 'Ketten-Hinweis vorhanden').toBeTruthy()
  await page.mouse.click(fx, fy)
  const pop = page.getByTestId('sigfield-info')
  await expect(pop).toBeVisible()
  await expect(page.getByTestId('sigfield-info-trustnote')).toBeVisible({ timeout: 15_000 })
  await expect(pop).toContainText(/CA trusted\s*no/i)
  await page.getByTestId('sigfield-info-close').click()

  // 2) Anker-Import ueber denselben HTTP-Pfad, den das UI-Panel benutzt.
  const caB64 = fs.readFileSync(caPem).toString('base64')
  const st = await page.evaluate(async ([u, b, tok]) => {
    const r = await fetch(`${u}/trust/anchors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Auth-Token': tok },
      body: JSON.stringify({ cert: b, filename: 'r67-ca.pem' })
    })
    return r.status
  }, [BACKEND, caB64, TOKEN] as [string, string, string])
  expect(st, 'Anker-Import 200').toBe(200)

  // 3) NACH dem Import: Daten + UI sagen trusted — dasselbe Dokument, kein
  //    erneutes Signieren; die Datei wurde dadruch nicht veraendert (intact).
  await expect(async () => {
    const after = await (await fetch(`${BACKEND}/document/signatures`, { headers: { 'X-Auth-Token': TOKEN } })).json()
    expect(after.signatures[0].trusted, 'mit Anker: trusted').toBe(true)
    expect(after.signatures[0].intact).toBe(true)
  }, { timeout: 10_000, intervals: [500] }).toPass()
  await page.mouse.click(fx, fy)
  await expect(pop).toBeVisible()
  await expect(pop).toContainText(/CA trusted\s*yes/i, { timeout: 15_000 })
  await expect(page.getByTestId('sigfield-info-trustnote')).toHaveCount(0)
  await page.getByTestId('sigfield-info-close').click()

  // 4) Aufraeumen: Anker wieder entfernen, damit spaetere Laeufe sauber starten.
  const del = await page.evaluate(async ([u, tok]) => {
    const l = await (await fetch(`${u}/trust/anchors`, { headers: { 'X-Auth-Token': tok } })).json()
    let code = 200
    for (const a of l.anchors) {
      const r = await fetch(`${u}/trust/anchors/${encodeURIComponent(a.id)}`, {
        method: 'DELETE', headers: { 'X-Auth-Token': tok }
      })
      code = r.status
    }
    return code
  }, [BACKEND, TOKEN] as [string, string])
  expect(del).toBe(200)
})
