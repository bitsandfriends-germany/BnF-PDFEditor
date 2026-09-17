// §6-Tastatur live: Seite per Tab-Fokus erreichen (page-slot ist fokussierbar),
// Shift+F10 oeffnet das Canvas-Kontextmenue, Menuepunkt aus der Registry ausfuehren —
// Beweis auf der PLATTENDATEI (pymupdf liest /Rotate der betroffenen Seite).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-kbd-'))
  file = path.join(dir, 'doc.pdf')
  await run(py, ['-c',
    `import sys, pymupdf\nd=pymupdf.open()\nfor i in (1,2):\n p=d.new_page()\n p.insert_text((72,120),'MARK-K%d'%i,fontsize=24)\nd.save(sys.argv[1]); d.close()`,
    file])
})

test('Shift+F10 am Seiten-Fokus: Menue -> Rotation wirkt auf Plattendatei', async ({ page }) => {
  test.setTimeout(60_000)
  await installBridgeStub(page, BACKEND, TOKEN)
  await setDialogPaths(page, file)
  await page.goto('http://localhost:5199/')
  await page.getByTestId('tb-open').click()
  await expect(page.getByTestId('page-count')).toContainText('2', { timeout: 30_000 })
  await expect(page.locator('[data-testid^="page-slot-"]').first()).toBeVisible({ timeout: 20_000 })

  // Fokus auf Seite 1 (echter Tab-Fokus: Slot ist fokussierbar), dann Shift+F10.
  await page.evaluate(() => (document.querySelector('[data-testid="page-slot-1"]') as HTMLElement).focus())
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? ''), { timeout: 5_000 }).toBe('page-slot-1')
  await page.keyboard.press('Shift+F10')

  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible({ timeout: 5_000 })
  // R55 2.Ebenen: Rotation im PDF-Flyout. Die Taste selbst (Shift+F10 -> Menue am
  // Fokus) ist der Kern dieses Tests; die Flyout-Navigation ist Unit-geprueft.
  await menu.getByTestId('ctx-group-grp.pdf').click()
  await menu.getByTestId('ctx-pg-rot-right').click()
  await expect(menu).toBeHidden({ timeout: 3_000 })

  // Speichern, dann /Rotate der Seite 1 auf der Platte pruefen (zweite Bibliothek).
  await page.keyboard.press('Control+s')
  const PY = `
import sys, pymupdf
d=pymupdf.open(sys.argv[1])
print('R1=%d R2=%d N=%d' % (d[0].rotation, d[1].rotation, d.page_count))
`
  await expect.poll(async () => {
    const { stdout } = await run(py, ['-c', PY, file])
    return stdout.trim()
  }, { timeout: 30_000, intervals: [1000, 2000] }).toBe('R1=90 R2=0 N=2')
})
