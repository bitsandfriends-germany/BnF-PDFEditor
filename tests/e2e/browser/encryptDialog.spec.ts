// §3-Zeile "Encryption" durch die ECHTE UI: Eigenschaften-Panel -> 'Verschluesseln' ->
// Passwort -> anwenden -> Speichern (Strg+S auf den Originalpfad, da 'save' ohne Dialog).
// Asserts auf der GESPEICHERTEN Datei auf Platte (pikepdf/pymupdf): ohne Passwort NICHT oeffnbar,
// MIT Passwort oeffnbar, /CFM AESV3 /Length 256 /R 6, Seitenzahl unveraendert, Inhalt mit
// Passwort extrahierbar. (GET /document/file ist der Entschluesselte Rendering-Stream fuer
// pdf.js und dafuer per Design nicht die Beweisdatei.)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-enc-'))
  file = path.join(dir, 'plain.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in (1,2):\n p=d.new_page()\n p.insert_text((72,120),'MARK-E%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Verschluesselungsdialog: Datei ohne PW zu, mit PW AES-256 offen', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })

  await page.getByTestId('sidebar-tab-properties').click()
  await page.getByTestId('prop-encrypt').click()
  await page.getByTestId('enc-user-pw').fill('GEHEIM-PW-42')
  await page.getByTestId('enc-run').click()
  await page.keyboard.press('Control+s')

  const PY = `
import sys, urllib.request, io, pikepdf, pymupdf
raw=open(sys.argv[3],'rb').read()
closed='CLOSED'
try:
    pikepdf.open(io.BytesIO(raw)); closed='OPEN-WITHOUT'
except pikepdf.PasswordError: pass
try:
    d=pikepdf.open(io.BytesIO(raw), password='GEHEIM-PW-42')
    enc=d.trailer['/Encrypt']
    cfm=str(enc['/CF']['/StdCF']['/CFM']); ln=int(enc.get('/Length')); v=int(enc.get('/V')); r=int(enc.get('/R'))
    assert cfm=='/AESV3' and ln==256
    md=pymupdf.open('pdf', io.BytesIO(raw)); md.authenticate('GEHEIM-PW-42')
    txt=''.join(pg.get_text() for pg in md)
    print(closed, len(d.pages), cfm, v, r, 'MARKS' if ('MARK-E1' in txt and 'MARK-E2' in txt) else 'NOMARKS')
except Exception as e:
    print('OPENFAIL', type(e).__name__, repr(e)[:120])
`
  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY, BACKEND, TOKEN, file])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toBe('CLOSED 2 /AESV3 5 6 MARKS')
})
