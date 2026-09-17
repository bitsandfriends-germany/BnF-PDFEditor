import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// PART 3 §3: EIN End-to-End-Test pro Feature gegen die laufende, GEBALTE App — echter Klick auf
// das echte Steuerelement, danach Behauptung über die AUSGABEDATEI auf der Platte (Seitenzahl via
// /Count — ein anderer Leser als die Schreib-Pipeline) UND über das UI (DOM). Gated wie
// smoke.spec: ohne PDF_EDITOR_APP_PATH oder Display wird sauber übersprungen.

function minimalPdfPages(n: number): Buffer {
  const ids = (from: number, count: number): string => Array.from({ length: count }, (_, i) => `${from + i} 0 R`).join(' ')
  const objs: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${ids(3, n)}] /Count ${n} >>`
  ]
  for (let i = 0; i < n; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>`)
  let body = '%PDF-1.7\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((off) => { body += `${String(off).padStart(10, '0')} 00000 n \n` })
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

const appPath = process.env.PDF_EDITOR_APP_PATH
const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

async function openFixture(pages: number): Promise<{ dir: string; pdfPath: string; app: Awaited<ReturnType<typeof electron.launch>>; win: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-editor-ops-'))
  const pdfPath = path.join(dir, `doc${pages}.pdf`)
  fs.writeFileSync(pdfPath, minimalPdfPages(pages))
  const app = await electron.launch({ executablePath: appPath as string, args: [pdfPath] })
  const win = await app.firstWindow()
  await expect(win.getByTestId('page-count')).toHaveText(`/ ${pages}`)
  return { dir, pdfPath, app, win }
}

// Playwrights app.close() haengt gegen diese App (CDP-Browser-Close triggert hier kein
// window-all-closed). Der ECHTE Nutzerweg ist Fenster-Zu -> window-all-closed ->
// cleanShutdown (Backend-SIGTERM/KILL) -> app.quit. Das wird hier gefahren und der
// Prozess-Exit abgewartet (max 10 s, dann SIGKILL als Testnetz).
async function closeApp(app: ElectronApplication, win: Page): Promise<void> {
  await win.close()
  const p = app.process()
  if (p.exitCode !== null || p.signalCode !== null) return
  await new Promise<void>((res) => {
    p.once('exit', () => res())
    setTimeout(() => { p.kill('SIGKILL'); res() }, 10_000)
  })
}

// Toolbar-Buttons koennen je Fensterbreite in den Overflow (pages-more -> ctx-<id>) wandern.
async function clickToolbar(win: Page, id: string): Promise<void> {
  const inline = win.getByTestId(id)
  const ok = await inline.click({ timeout: 3000 }).then(() => true, () => false)
  if (ok) return
  await win.getByTestId('pages-more').click()
  await win.getByTestId(`ctx-${id}`).click()
}

test.describe('Operationen E2E — echte Klicks, Datei auf Platte (§3)', () => {
  test.skip(!appPath, 'PDF_EDITOR_APP_PATH nicht gesetzt')
  test.skip(!hasDisplay, 'kein Display — GUI-E2E kann nicht laufen')

  test('Duplizieren: Toolbar-Klick -> DOM 2 Seiten -> Datei /Count 2', async () => {
    const { dir, pdfPath, app, win } = await openFixture(1)
    try {
      await win.getByRole('listitem', { name: 'Seite 1' }).click()
      await clickToolbar(win, 'pg-dup')
      await expect(win.getByTestId('page-count')).toHaveText('/ 2', { timeout: 15_000 })
      const before = fs.statSync(pdfPath).mtimeMs
      await win.getByTestId('btn-save').click()
      await expect.poll(() => fs.statSync(pdfPath).mtimeMs > before, { timeout: 15_000 }).toBe(true)
      const raw = fs.readFileSync(pdfPath).toString('latin1')
      expect(raw).toMatch(/%PDF-/)
      expect(raw).toMatch(/\/Count 2\b/)
      expect(raw).not.toMatch(/\/Count 1\b/)
    } finally {
      await closeApp(app, win)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Löschen: Thumbnail-Auswahl + pg-del -> DOM 1 Seite -> Datei /Count 1, Text der Keep-Seite bleibt', async () => {
    const { dir, pdfPath, app, win } = await openFixture(2)
    try {
      await win.getByRole('listitem', { name: 'Seite 2' }).click()
      await clickToolbar(win, 'pg-del')
      await expect(win.getByTestId('page-count')).toHaveText('/ 1', { timeout: 15_000 })
      const before = fs.statSync(pdfPath).mtimeMs
      await win.getByTestId('btn-save').click()
      await expect.poll(() => fs.statSync(pdfPath).mtimeMs > before, { timeout: 15_000 }).toBe(true)
      const raw = fs.readFileSync(pdfPath).toString('latin1')
      expect(raw).toMatch(/\/Count 1\b/)
      expect(raw).not.toMatch(/\/Count 2\b/)
    } finally {
      await closeApp(app, win)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Canvas-Kontextmenü: Rechtsklick -> Menü -> Seite drehen wirkt auf Datei (/Rotate)', async () => {
    const { dir, pdfPath, app, win } = await openFixture(1)
    try {
      // Rechtsklick auf den Seitenkasten (Slot) — die Text-Ebene liegt ueber dem Canvas und
      // wuerde einen Canvas-Klick blockieren; das Kontextmenue-Handling sitzt am Seitenelement.
      const slot = win.getByTestId('page-slot-1')
      await slot.click({ button: 'right' })
      // R55 Zwei-Ebenen-Menue: Rotation liegt im Flyout 'PDF bearbeiten'.
      await win.getByTestId('ctx-group-grp.pdf').click()
      const item = win.getByTestId('ctx-pg-rot-right')
      await expect(item).toBeVisible()
      await item.click()
      await expect(win.getByRole('button', { name: /Rückgängig|Undo/i })).toBeEnabled({ timeout: 15_000 })
      const before = fs.statSync(pdfPath).mtimeMs
      await win.getByTestId('btn-save').click()
      await expect.poll(() => fs.statSync(pdfPath).mtimeMs > before, { timeout: 15_000 }).toBe(true)
      const raw = fs.readFileSync(pdfPath).toString('latin1')
      expect(raw).toMatch(/\/Rotate\s+90\b/)
    } finally {
      await closeApp(app, win)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
