// R75 Nutzerwunsch: "er soll selber entscheiden ob gpu oder sw rendering besser funktioniert in den
// einstellungen waehlbar zusaetzlich. gib den einstellungen und ALLEN Funktionen on Hover Tooltips
// was die funktion macht. Auch in den Steings an und ausschaltbar."
//
// Geprueft am echten Renderer (Hover + Fokus), inkl. Nicht-Aenderung: ausgeschaltete Tooltips
// erscheinen wirklich nicht.
import { test, expect } from '@playwright/test'
import { installBridgeStub, setDialogPaths } from './bridge'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'

const run = promisify(execFile)
const root = path.resolve(__dirname, '../../..')
const py = path.join(root, 'backend', '.venv', 'bin', 'python')
const BACKEND = process.env['E2E_BACKEND_URL'] as string
const TOKEN = process.env['E2E_BACKEND_TOKEN'] as string

test.describe('R75: Tooltips + Rendering-Einstellung', () => {
  let file: string

  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-e2e-tips-'))
    file = path.join(dir, 'doc.pdf')
    await run(py, ['-c', `import sys, pymupdf
d=pymupdf.open(); d.new_page(width=595,height=842); d.save(sys.argv[1]); d.close()`, file])
  })

  test.beforeEach(async ({ page }) => {
    await installBridgeStub(page, BACKEND, TOKEN)
    await setDialogPaths(page, file)
    await page.goto('http://localhost:5199/')
    await page.getByTestId('tb-open').click()
    await expect(page.getByTestId('page-count')).toContainText('1', { timeout: 30_000 })
  })

  test('Hover zeigt, was die Funktion macht — abschaltbar in den Einstellungen', async ({ page }) => {
    test.setTimeout(90_000)
    // Toolbar-Layout abwarten (die Leiste vermisst sich nach dem Oeffnen neu; R75 gemessen).
    await page.waitForTimeout(1000)
    const zoomIn = page.getByTestId('tb-zoom-in')
    await zoomIn.hover()
    const tip = page.getByTestId('tip-tb-zoom-in')
    await expect(tip, 'Tooltip erscheint beim Verweilen').toBeVisible({ timeout: 5_000 })
    const text = (await tip.textContent()) ?? ''
    expect(text.length, 'Tooltip nennt die Funktion').toBeGreaterThanOrEqual(6)
    expect(text).toMatch(/Zoom/i)

    // Tooltip verschwindet wieder beim Verlassen.
    await page.mouse.move(5, 5)
    await expect(tip).toHaveCount(0, { timeout: 5_000 })

    // In den Einstellungen abschalten (globaler Shortcut Strg+, wie im Nutzerhandbuch).
    await page.keyboard.press('Control+Comma')
    await expect(page.getByTestId('settings-render-mode')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('settings-tooltips').click()
    await expect(page.getByTestId('settings-tooltips')).not.toBeChecked()
    await page.getByTestId('settings-close').click()

    // NICHT-Aenderung: bei ausgeschalteten Tooltips erscheint keine Ueberlagerung mehr.
    await page.mouse.move(2, 2)
    await zoomIn.hover()
    await page.waitForTimeout(600)
    await expect(page.getByTestId('tip-tb-zoom-in')).toHaveCount(0)
  })

  test('Render-Modus ist waehlbar und bleibt gespeichert (Automatik/GPU/Software)', async ({ page }) => {
    test.setTimeout(90_000)
    await page.keyboard.press('Control+Comma')
    const select = page.getByTestId('settings-render-mode')
    await expect(select).toBeVisible({ timeout: 10_000 })
    // Automatik ist der Startwert und nennt den aktuell aktiven Modus.
    await expect(select).toHaveValue('auto')
    await expect(page.getByTestId('settings-render-effective')).toContainText(/GPU|Software/)
    await expect(page.getByTestId('settings-render-hint')).toContainText(/Software|GPU/)

    await select.selectOption('software')
    await expect(select).toHaveValue('software')
    await page.getByTestId('settings-close').click()
    // Erneut oeffnen: der Wert kommt aus den gespeicherten Einstellungen zurueck.
    await page.keyboard.press('Control+Comma')
    await expect(page.getByTestId('settings-render-mode')).toHaveValue('software', { timeout: 10_000 })
  })
})
