import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import { spawn } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'

// Smoke gegen die GEBALTE App (Section 12): Start -> PDF oeffnen -> Seite drehen -> Speichern ->
// sauber beenden. Der Pfad zum gebauten Electron-Binary kommt aus PDF_EDITOR_APP_PATH
// (scripts/build.sh). Ohne gesetzten Pfad oder ohne Display wird sauber uebersprungen.

function minimalPdf(): Buffer {
  // Minimales, gueltiges 1-Seiten-PDF (A4). pdfjs kann es oeffnen; MuPDF dreht/speichert es.
  const objs: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'
  ]
  let body = '%PDF-1.7\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((off) => {
    body += `${String(off).padStart(10, '0')} 00000 n \n`
  })
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

const appPath = process.env.PDF_EDITOR_APP_PATH
const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

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

test.describe('Smoke — gebaute App', () => {
  test.skip(!appPath, 'PDF_EDITOR_APP_PATH nicht gesetzt (gebautes App-Binary fehlt)')
  test.skip(!hasDisplay, 'kein Display (DISPLAY/WAYLAND_DISPLAY) — GUI-E2E kann nicht laufen')

  test('Start, oeffnen, drehen, speichern, beenden', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-editor-smoke-'))
    const pdfPath = path.join(dir, 'test.pdf')
    fs.writeFileSync(pdfPath, minimalPdf())

    // argv[1] = PDF -> die App oeffnet sie beim Start (Desktop-%f-Pfad, ohne nativen Dialog).
    const app = await electron.launch({ executablePath: appPath as string, args: [pdfPath] })
    try {
      const win = await app.firstWindow()

      // 1) Shell gerendert (Backend-Orchestrierung + UI): "Öffnen"-Button sichtbar.
      await expect(win.getByTestId('tb-open')).toBeVisible()

      // 2) Dokument via argv geoeffnet -> Seitenzaehler zeigt "/ 1".
      await expect(win.getByTestId('page-count')).toHaveText('/ 1')

      // 3) Erste Seite ueber das Thumbnail um 90° drehen -> Undo wird veraugendbar.
      const firstThumb = win.getByRole('listitem', { name: 'Seite 1' })
      await firstThumb.hover()
      await win.getByTestId('thumb-rotate-0').click()
      await expect(win.getByRole('button', { name: /Rückgängig|Undo/i })).toBeEnabled()

      // 4) Speichern (ueberschreibt die argv-Datei, kein Dialog da Originalpfad bekannt).
      const before = fs.statSync(pdfPath)
      await win.getByTestId('btn-save').click()
      await expect
        .poll(() => fs.statSync(pdfPath).mtimeMs > before.mtimeMs, { timeout: 15_000 })
        .toBe(true)

      // 5) Datei ist weiterhin ein gueltiges PDF.
      const head = fs.readFileSync(pdfPath).subarray(0, 5).toString('latin1')
      expect(head).toBe('%PDF-')

      // 6) Sauber beenden (Backend-Terminierung ueber den Shutdown-Hook).
      await closeApp(app, win)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  // R74 Nutzerbefund "das programm laesst sich nicht starten": Die Single-Instance-Sperre beendet
  // jeden weiteren Start. Dieser Test startet die App ZWEIMAL (echter Nutzerweg: App-Menue doppelt
  // oder Starter + Menue) und prueft, dass die zweite Instanz sauber endet UND das Fenster der
  // ersten Instanz sichtbar/bedienbar bleibt — frueher passierte bei kaputtem/verstecktem Fenster
  // sichtbar nichts.
  test('Zweiter Start: Sperre greift, erstes Fenster bleibt bedienbar', async () => {
    const app = await electron.launch({ executablePath: appPath as string })
    try {
      const win = await app.firstWindow()
      await expect(win.getByTestId('tb-open')).toBeVisible()

      // Zweite Instanz direkt starten (wie der Starter es tut) und ihren Exit abwarten.
      const second = spawn(appPath as string, [], { stdio: 'ignore', detached: false })
      const exit = await new Promise<{ code: number | null; ms: number }>((resolve) => {
        const t0 = Date.now()
        const timer = setTimeout(() => {
          second.kill('SIGKILL')
          resolve({ code: null, ms: Date.now() - t0 })
        }, 20_000)
        second.once('exit', (code) => {
          clearTimeout(timer)
          resolve({ code, ms: Date.now() - t0 })
        })
      })
      expect(exit.code, 'zweite Instanz endet ohne Fehler (Sperre)').toBe(0)
      expect(exit.ms, 'zweite Instanz blockiert den Start nicht').toBeLessThan(20_000)

      // Die erste Instanz lebt weiter und ihre Oberflaeche reagiert (kein stiller Blindstart).
      await expect(win.getByTestId('tb-open')).toBeVisible()
      await win.getByTestId('sidebar-tab-thumbnails').click().catch(() => undefined)
      const pageCount = await win.getByTestId('page-count').textContent()
      expect(pageCount ?? '').toContain('/')

      // Nur EIN Anwendungsfenster ist offen (keine zweite Sitzung).
      expect(app.windows().length, 'genau ein Fenster').toBe(1)
      await closeApp(app, win)
    } finally {
      // nichts aufzuraeumen (kein Fixture-Verzeichnis)
    }
  })
})
