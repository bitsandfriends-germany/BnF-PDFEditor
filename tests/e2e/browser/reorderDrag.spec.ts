// §3-Zeile "Reorder pages" durch die ECHTE UI: Thumbnail 1 per HTML5-Drag unter Thumbnail 3
// ziehen (untere Haelfte => after). Assert (pikepdf auf GET /document/file): Seitenzahl 4
// unveraendert, MARK-Sequenz exakt [2,3,1,4] ( verschobener Block nach Seite 3), alle Texte da.
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

const PY_MARKS = `
import sys, urllib.request, pikepdf, io
from pikepdf import Array, String
req=urllib.request.Request(sys.argv[1]+"/document/file", headers={"X-Auth-Token":sys.argv[2]})
raw=urllib.request.urlopen(req).read()
d=pikepdf.open(io.BytesIO(raw))
def txt(pg):
    acc=[]
    def eat(o):
        if isinstance(o,String): acc.append(bytes(o).decode('latin-1'))
        elif isinstance(o,Array):
            for x in o: eat(x)
    for ops,op in pikepdf.parse_content_stream(pg):
        for o in ops: eat(o)
    return ''.join(acc)
out=[]
for pg in d.pages:
    s=txt(pg)
    hits=[i for i in (1,2,3,4) if ('MARK-R%d'%i) in s]
    out.append(hits[0] if hits else 0)
print(len(d.pages), out)
`

let file: string
test.beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-reord-'))
  file = path.join(dir, 'four.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in range(1,5):\n p=d.new_page()\n p.insert_text((72,120),'MARK-R%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Drag von Thumbnail 1 unter Thumbnail 3: Reihenfolge [2,3,1,4]', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('4', { timeout: 30_000 })
  const src = page.getByTestId('thumb-wrap-0')
  await src.waitFor({ state: 'visible', timeout: 20_000 })
  const dst = page.getByTestId('thumb-wrap-2')
  const srcBox = await src.boundingBox()
  const dstBox = await dst.boundingBox()
  expect(srcBox).not.toBeNull()
  expect(dstBox).not.toBeNull()

  // HTML5-DnD mit echter Mausgeste: untere Haelfte des Ziels => after=true.
  await page.mouse.move(srcBox!.x + srcBox!.width / 2, srcBox!.y + srcBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(dstBox!.x + dstBox!.width / 2, dstBox!.y + dstBox!.height * 0.75, { steps: 12 })
  await page.mouse.up()

  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY_MARKS, BACKEND, TOKEN])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toBe('4 [2, 3, 1, 4]')
})
