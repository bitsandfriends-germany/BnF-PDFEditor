// §3-Zeile Delete: Seitenzahl sinkt exakt um N, der eindeutige Text der geloeschten Seite ist
// weg, die Texte der Keep-Seiten bleiben in urspruenglicher Reihenfolge. Echter Klickpfad:
// Seitensprung auf 2 (tb-page-input), dann pg-del; Beweis mit pikepdf am Arbeitsstand.
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

async function python(code: string, ...args: string[]): Promise<string> {
  const { stdout } = await run(py, ['-c', code, ...args])
  return stdout.trim()
}

test.describe('Browser-E2E: Loeschen entfernt exakt die angezeigte Seite', () => {
  let file: string

  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-del-'))
    file = path.join(dir, 'three.pdf')
    await python(
      `import sys, pymupdf\nd=pymupdf.open()\nfor i in (1,2,3):\n    pg=d.new_page(); pg.insert_text((72,72),'MARK-P%d'%i)\nd.save(sys.argv[1]); d.close()`,
      file
    )
  })

  test('Seite 2 loeschen: 2 Seiten, MARK-P2 fort, MARK-P1 vor MARK-P3', async ({ page }) => {
    await installBridgeStub(page, BACKEND, TOKEN)
    await setDialogPaths(page, file)
    await page.goto('http://localhost:5199/')

    await page.getByTestId('tb-open').click()
    await expect(page.getByTestId('page-count')).toContainText('3', { timeout: 30_000 })

    await page.getByTestId('tb-page-input').fill('2')
    await page.getByTestId('tb-page-input').press('Enter')
    await page.getByTestId('pg-del').click()

    await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 20_000 })

    const report = await python(
      `import sys, urllib.request, pikepdf, io\n` +
      `req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})\n` +
      `p=pikepdf.open(io.BytesIO(urllib.request.urlopen(req).read()))\n` +
      `def strs(pg):\n` +
      `    acc=b''\n` +
      `    for operands, op in pikepdf.parse_content_stream(pg):\n` +
      `        for o in operands:\n` +
      `            if isinstance(o, pikepdf.Array):\n` +
      `                for x in o:\n` +
      `                    if isinstance(x, pikepdf.String): acc += bytes(x)\n` +
      `            elif isinstance(o, pikepdf.String): acc += bytes(o)\n` +
      `    return acc\n` +
      `pgs=[strs(pg) for pg in p.pages]\n` +
      `print(len(pgs), b'MARK-P2' in pgs[0] or b'MARK-P2' in pgs[1], b'MARK-P1' in pgs[0], b'MARK-P3' in pgs[1])`,
      BACKEND, TOKEN
    )
    expect(report).toBe('2 False True True')
  })
})
