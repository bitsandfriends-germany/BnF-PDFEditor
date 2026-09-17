// §3-Zeile "Split" durch die ECHTE UI: 4-Seiten-Fixture MARK-S1..4, Teilen alle 2 Seiten.
// Assert: Seitenzahlen der erzeugten Dateien summieren auf 4; in Datei-Reihenfolge aneinander-
// gereiht ergibt sich die ORIGINAL-Seitenreihenfolge (pikepdf, zweite Bibliothek); Quelldatei
// bleibt auf der Platte unveraendert (SHA-256).
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import { installBridgeStub, setDialogPaths, setDestDir } from './bridge'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

const PY_MARKS = `
import sys, pikepdf
from pikepdf import Array, String
def page_strings(pg):
    out = []
    def emit(o):
        if isinstance(o, (String, bytes)):
            out.append((o if isinstance(o, bytes) else bytes(o)).decode('latin-1'))
        elif isinstance(o, Array):
            for x in o: emit(x)
    for operands, _op in pikepdf.parse_content_stream(pg):
        for a in operands: emit(a)
    return ' '.join(out)
doc = pikepdf.open(sys.argv[1])
marks = []
for pg in doc.pages:
    s = page_strings(pg)
    for i in (1, 2, 3, 4):
        if ('MARK-S%d' % i) in s: marks.append(i)
print(len(doc.pages), marks)
`

let file: string
let dir: string
test.beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-split-'))
  file = path.join(dir, 'four.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in range(1,5):\n p=d.new_page()\n p.insert_text((72,120),'MARK-S%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
  fs.copyFileSync(file, path.join(dir, 'four.orig'))
})

test('Split alle 2 Seiten: Summe 4, Reihenfolge erhalten, Quelle unveraendert', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await setDestDir(page, path.join(dir, 'out'))
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true })
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })

  // Toolbar-Gruppe kann ins Overflow-Menue wandern — beide Wege akzeptieren (echter Nutzerstatus).
  const inline = page.getByTestId('pg-split')
  if (await inline.isVisible().catch(() => false)) {
    await inline.click()
  } else {
    await page.getByTestId('pages-more').click()
    await page.getByTestId('ctx-pg-split').click()
  }
  await expect(page.getByTestId('dlg-split-mode')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('dlg-split-mode').selectOption('everyN')
  await page.getByTestId('split-count').fill('2')
  await page.getByTestId('dlg-dir-choose').click()
  await page.getByTestId('split-run').click()
  await expect.poll(async () => fs.readdirSync(path.join(dir, 'out')).filter((f) => f.endsWith('.pdf')).length, { timeout: 30_000 }).toBe(2)

  const outs = fs.readdirSync(path.join(dir, 'out')).filter((f) => f.endsWith('.pdf')).sort()
  let totalPages = 0
  const seq: number[] = []
  for (const f of outs) {
    const { stdout } = await run(py, ['-c', PY_MARKS, path.join(dir, 'out', f)])
    const m = stdout.trim().match(/^(\d+) \[([\d, ]*)\]$/)
    expect(m, `Ausgabe ${f} lesbar mit pikepdf`).not.toBeNull()
    totalPages += parseInt(m![1]!, 10)
    for (const n of m![2]!.split(',').map((x) => x.trim()).filter(Boolean)) seq.push(parseInt(n, 10))
  }
  expect(totalPages, 'Seitenzahlen summieren auf das Original').toBe(4)
  expect(seq, 'aneinandergereiht == urspruengliche Seitenreihenfolge').toEqual([1, 2, 3, 4])

  const sha = (p: string): string => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  expect(sha(file), 'Quelldatei auf der Platte unveraendert').toBe(sha(path.join(dir, 'four.orig')))
})
