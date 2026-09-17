// §1-Leitklage als E2E: "Append PDF appended nicht." Echter Klick-Pfad: Oeffnen ->
// sidebar-append -> echter Merge-Endpunkt; Beweis auf der Platte (Zieldatei) auf der Platte mit pikepdf (zweite Bibliothek)
// gegengeprueft: Seitenzahl = Summe, letzte Seiten tragen den Quelltext, Urseiten unveraendert,
// Gliederungseintraege BEIDER Dokumente vorhanden.
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { installBridgeStub, setDialogQueue } from './bridge'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

async function python(code: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(py, ['-c', code, ...args])
  return stdout.trim()
}

test.describe('Browser-E2E: Anhangen (Append) per echtem UI-Pfad', () => {
  let target: string
  let source: string

  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-ap-'))
    target = path.join(dir, 'target.pdf')
    source = path.join(dir, 'source.pdf')
    await python(
      `import sys, pymupdf\nd=pymupdf.open()\np=d.new_page(); p.insert_text((72,72),'A1MARK')\np2=d.new_page(); p2.insert_text((72,72),'A2MARK')\nd.set_toc([[1,'ZIEL-KAPITEL',1]])\nd.save(sys.argv[1]); d.close()\nq=pymupdf.open()\na=q.new_page(); a.insert_text((72,72),'B1MARK')\nb=q.new_page(); b.insert_text((72,72),'B2MARK')\nq.set_toc([[1,'QUELL-KAPITEL',1]])\nq.save(sys.argv[2]); q.close()`,
      target, source
    )
  })

  test('PDF anhaengen (sidebar-append -> /pages/merge): Quellseiten hinten an, Ziel + Gliederung heil', async ({ page }) => {
    await installBridgeStub(page, BACKEND, TOKEN)
    await setDialogQueue(page, [target, source])
    await page.goto('http://localhost:5199/')

    await page.getByTestId('tb-open').click()
    await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })

    await page.getByTestId('sidebar-append').click()
    await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })

    const report = await python(
      `import sys, urllib.request, pikepdf, io\n` +
      `req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\n` +
      `raw=urllib.request.urlopen(req).read()\n` +
      `p=pikepdf.open(io.BytesIO(raw))\n` +
      `def page_strings(pg):\n` +
      `    out=b''\n` +
      `    def eat(o):\n` +
      `        nonlocal out\n` +
      `        if isinstance(o, pikepdf.Array):\n` +
      `            for x in o: eat(x)\n` +
      `        elif isinstance(o, pikepdf.String): out += bytes(o)\n` +
      `    for operands, op in pikepdf.parse_content_stream(pg):\n` +
      `        for o in operands: eat(o)\n` +
      `    return out\n` +
      `pages=[page_strings(pg) for pg in p.pages]\n` +
      `toc=[e.title for e in p.open_outline().root]\n` +
      `print(len(p.pages), b"A1MARK" in pages[0], b"A2MARK" in pages[1], b"B1MARK" in pages[2], b"B2MARK" in pages[3], sorted(toc))`,
      BACKEND, TOKEN
    )
    expect(report).toBe("4 True True True True ['QUELL-KAPITEL', 'ZIEL-KAPITEL']")
  })
})
