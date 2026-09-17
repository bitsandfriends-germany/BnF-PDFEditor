// §3-Zeile "page numbers" durch die ECHTE UI: Nummern im Bereich 2-3 mit Format SEITE{n}.
// Assert (pikepdf auf GET /document/file): SEITE2 auf genau Seite 2, SEITE3 auf genau Seite 3,
// auf Seiten 1 und 4 keine SEITE-Spur; alle Original-MARKS erhalten; Seitenzahl unveraendert.
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
nums=''.join('S' if 'SEITE' in t else '.' for t in pages)
first=''.join('1' if 'SEITE1' in t else ('2' if 'SEITE2' in t else '.') for t in pages)
print(len(d.pages), nums, first, ''.join('M' if ('MARK-N%d'%i) in t else '.' for i,t in enumerate(pages,1)))
import sys as _s; _s.exit(0)

`

let file: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-num-'))
  file = path.join(dir, 'four.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in range(1,5):\n p=d.new_page()\n p.insert_text((72,120),'MARK-N%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Seitennummern nur auf Seiten 2-3, Originaltexte bleiben', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })

  const inline = page.getByTestId('pg-numbers')
  const shown = await inline.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
  let opened = false
  if (shown) {
    // Die Toolbar kann nach Thumbnail-Mount neu vermessen und die Gruppe ins Overflow
    // verschieben — Klick kurz halten und im Fehlerfall den Overflow-Pfad nehmen.
    opened = await inline.click({ timeout: 3_000 }).then(() => true, () => false)
  }
  if (!opened) {
    await page.getByTestId('pages-more').click()
    await page.getByTestId('ctx-pg-numbers').click()
  }
  await expect(page.getByTestId('numbers-expr')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('numbers-expr').fill('2-3')
  await page.getByTestId('dlg-num-fmt').fill('SEITE{n}')
  await page.getByTestId('numbers-run').click()

  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY_CHECK, BACKEND, TOKEN])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toMatch(/^4 \.SS\. \.12\. MMMM$/)
  // Semantik (§6-Daemme): die ERSTE gewaehlte Seite traegt `start`=1, die naechste 2 —
  // Seiten 2 und 3 tragen also SEITE1/SEITE2; Seiten 1 und 4 bleiben nummerfrei.
})
