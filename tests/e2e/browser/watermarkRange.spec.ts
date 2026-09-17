// §3-Zeile "Watermark" durch die ECHTE UI: 4-Seiten-Fixture MARK-W1..4, WasserTEXT nur auf
// Seiten 2-3. Assert (pikepdf auf GET /document/file): Wasserzeichen-String auf genau Seiten
// 2 und 3, NICHT auf 1 und 4; Seitenzahl unveraendert; alle Original-MARKS noch vorhanden
// (kein unbeabsichtigter Seitentext-Verlust).
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

const PY_CHECK = `
import sys, urllib.request, pikepdf, io
from pikepdf import Array, String
req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})
raw=urllib.request.urlopen(req).read()
d=pikepdf.open(io.BytesIO(raw))
def txt(pg):
    s=''
    def eat(o):
        nonlocal s
        if isinstance(o, String): s += bytes(o).decode('latin-1')
        elif isinstance(o, Array):
            for x in o: eat(x)
    for operands,_op in pikepdf.parse_content_stream(pg):
        for o in operands: eat(o)
    return s
pages=[txt(pg) for pg in d.pages]
wm=[('WASSERTEXT' in t) for t in pages]
marks=[('MARK-W%d'%i) in t for i,t in enumerate(pages,1)]
print(len(d.pages), ''.join('T' if x else 'F' for x in wm), ''.join('T' if x else 'F' for x in marks))
`

let file: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-wm-'))
  file = path.join(dir, 'four.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in range(1,5):\n p=d.new_page()\n p.insert_text((72,120),'MARK-W%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('WasserTEXT nur auf Seiten 2-3, Originaltexte bleiben', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })

  const inline = page.getByTestId('pg-watermark')
  const shown = await inline.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
  let opened = false
  if (shown) {
    // Die Toolbar kann nach Thumbnail-Mount neu vermessen und die Gruppe ins Overflow
    // verschieben — Klick kurz halten und im Fehlerfall den Overflow-Pfad nehmen.
    opened = await inline.click({ timeout: 3_000 }).then(() => true, () => false)
  }
  if (!opened) {
    await page.getByTestId('pages-more').click()
    await page.getByTestId('ctx-pg-watermark').click()
  }
  await expect(page.getByTestId('wm-text')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('watermark-expr').fill('2-3')
  await page.getByTestId('wm-text').fill('WASSERTEXT')
  await page.getByTestId('watermark-run').click()
  await expect(page.getByTestId('wm-text')).toBeHidden({ timeout: 30_000 })

  const { stdout } = await run(py, ['-c', PY_CHECK, BACKEND, TOKEN])
  const m = stdout.trim().match(/^(\d+) ([TF]+) ([TF]+)$/)
  expect(m, 'Arbeitskopie mit pikepdf lesbar').not.toBeNull()
  expect(parseInt(m![1]!, 10), 'Seitenzahl unveraendert').toBe(4)
  expect(m![2]!, 'Wasserzeichen genau auf Seiten 2-3').toBe('FTTF')
  expect(m![3]!, 'Original-MARKS alle noch da').toBe('TTTT')
})
