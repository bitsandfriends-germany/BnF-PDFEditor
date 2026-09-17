// §3-Zeile Extract: neue Datei mit genau den gewuenschten Seiten UND die Quelle bleibt auf der
// Platte unveraendert. Echter UI-Pfad: pg-extract -> Bereich 2 -> Zielverzeichnis -> ausfuehren.
import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { installBridgeStub, setDialogPaths, setDestDir } from './bridge'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

async function python(code: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(py, ['-c', code, ...args])
  return stdout.trim()
}

test.describe('Browser-E2E: Extrahieren laesst die Quelle unveraendert', () => {
  let file: string
  let dir: string
  let dest: string

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-ex-'))
    file = path.join(dir, 'src3.pdf')
    dest = path.join(dir, 'out')
    fs.mkdirSync(dest)
    await python(
      `import sys, pymupdf\nd=pymupdf.open()\nfor i in (1,2,3):\n    pg=d.new_page(); pg.insert_text((72,72),'MARK-P%d'%i)\nd.save(sys.argv[1]); d.close()`,
      file
    )
    await run('cp', [file, file + '.orig'])
  })

  test('Extract von Seite 2 liefert 1-Seiten-Datei mit MARK-P2; Quelldatei byte-identisch', async ({ page }) => {
    await installBridgeStub(page, BACKEND, TOKEN)
    await setDialogPaths(page, file)
    await setDestDir(page, dest)
    await page.goto('http://localhost:5199/')

    await page.getByTestId('tb-open').click()
    await expect(page.getByTestId('page-count')).toContainText('3', { timeout: 30_000 })

    // Bei echter Chromium-Breite kann die extractSplit-Gruppe im Overflow-Menue landen —
    // beide Wege sind legitimer UI-Pfad; der Test folgt ihm.
    const inline = page.getByTestId('pg-extract')
    if ((await inline.count()) > 0 && await inline.first().isVisible()) {
      await inline.first().click()
    } else {
      await page.getByTestId('pages-more').click()
      await page.getByTestId('ctx-pg-extract').click()
    }
    await page.getByTestId('extract-expr').fill('2')
    await page.getByTestId('dlg-dir-choose').click()
    await page.getByTestId('extract-run').click()

    await expect.poll(async () => fs.readdirSync(dest).filter((f) => f.endsWith('.pdf')).length, { timeout: 20_000 }).toBe(1)
    const outPath = path.join(dest, fs.readdirSync(dest).find((f) => f.endsWith('.pdf')) as string)

    const [info, sameAsOrig] = await Promise.all([
      python(
        `import sys, pikepdf\np=pikepdf.open(sys.argv[1])\nacc=b''\nfor operands, op in pikepdf.parse_content_stream(p.pages[0]):\n    for o in operands:\n        if isinstance(o, pikepdf.Array):\n            for x in o:\n                if isinstance(x, pikepdf.String): acc += bytes(x)\n        elif isinstance(o, pikepdf.String): acc += bytes(o)\nprint(len(p.pages), b'MARK-P2' in acc, b'MARK-P1' in acc, b'MARK-P3' in acc)`,
        outPath
      ),
      python(
        `import sys, hashlib\nprint(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest()==hashlib.sha256(open(sys.argv[2],'rb').read()).hexdigest())`,
        file, file + '.orig'
      )
    ])
    expect(info).toBe('1 True False False')
    expect(sameAsOrig).toBe('True')
  })
})
