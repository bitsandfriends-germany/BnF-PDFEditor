// §3-Zeile "Insert pages" durch die ECHTE UI: 3-Seiten-Fixture MARK-I1..3, leere Seite VOR
// Seite 2 einfügen. Assert (pikepdf, zweite Bibliothek): 4 Seiten; MARKS sitzen auf Seiten
// 1,3,4 — die leere Seite ist an der GEWÜNSCHTEN Position (nicht am Ende); die Nachbarseiten
// tragen ihre Originaltexte unverändert.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-ins-'))
  file = path.join(dir, 'three.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in range(1,4):\n p=d.new_page()\n p.insert_text((72,120),'MARK-I%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Seite VOR Seite 2 eingefügt: Index korrekt, Nachbarn unverändert', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('3', { timeout: 30_000 })

  // Einfügen-Dialog über echte Kontrolle (Inline oder Overflow-Menü, je nach Breite).
  // Sidebar-Inhalt mountet nach dem Oeffnen; auf Inline-Sichtbarkeit warten statt Sofort-Check.
  const inline = page.getByTestId('pg-insert')
  const shown = await inline.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
  let opened = false
  if (shown) {
    // Die Toolbar kann nach Thumbnail-Mount neu vermessen und die Gruppe ins Overflow
    // verschieben — Klick kurz halten und im Fehlerfall den Overflow-Pfad nehmen.
    opened = await inline.click({ timeout: 3_000 }).then(() => true, () => false)
  }
  if (!opened) {
    await page.getByTestId('pages-more').click()
    await page.getByTestId('ctx-pg-insert').click()
  }
  await expect(page.getByTestId('dlg-ins-pos')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('dlg-ins-pos').selectOption('before')
  await page.getByTestId('insert-page').fill('2')
  await page.getByTestId('dlg-ins-kind').selectOption('blank')
  await page.getByTestId('insert-run').click()
  await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })

  // Zweitbibliothek auf der Arbeitskopie: GET /document/file (derselbe Weg wie rotateUndo),
  // Bytes mit pikepdf öffnen — prueft genau die Datei, die der Nutzer am Ende speichert.
  const dir0 = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-ins-chk-'))
  const workCopy = path.join(dir0, 'work.pdf')
  const check = await run(py, ['-c',
    `import sys, urllib.request, pikepdf, io\nfrom pikepdf import Array, String\nreq=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\nraw=urllib.request.urlopen(req).read()\nopen(sys.argv[3],"wb").write(raw)\nd=pikepdf.open(io.BytesIO(raw))\nout=[]\nfor pg in d.pages:\n    txt=''\n    for operands,_op in pikepdf.parse_content_stream(pg):\n        for o in operands:\n            if isinstance(o, String): txt += bytes(o).decode('latin-1')\n            elif isinstance(o, Array):\n                for x in o:\n                    if isinstance(x, String): txt += bytes(x).decode('latin-1')\n    hits=[i for i in (1,2,3) if ('MARK-I%d'%i) in txt]\n    out.append(hits[0] if hits else 0)\nprint(len(d.pages), out)`,
    BACKEND, TOKEN, workCopy])
  const m = check.stdout.trim().match(/^(\d+) \[([\d, ]*)\]$/)
  expect(m, 'Arbeitskopie mit pikepdf lesbar').not.toBeNull()
  expect(parseInt(m![1]!, 10), 'Seitenzahl 3+1').toBe(4)
  expect(m![2]!.replace(/\s/g, ''), 'leere Seite an Index 2 (nicht am Ende), Nachbarn unverändert').toBe('1,0,2,3')
})
