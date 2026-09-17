// R74: Verhalten beim zweiten Start (Single-Instance-Sperre).
//
// Nutzerbefund "das programm laesst sich nicht starten": Die Sperre beendet jeden weiteren Start.
// Existierte dabei kein nutzbares Fenster mehr (Instanz haengt versteckt/zerstört im Hintergrund),
// passierte fuer den Nutzer sichtbar NICHTS — der Klick auf das App-Menue wirkte wie ein Absturz.
// Diese Funktion ist bewusst von Electron entkoppelt (Fakes im Test) und kapselt die Regel:
// vorhandenes Fenster zeigen/fokussieren, sonst ein neues erzeugen.
export interface WindowLike {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  restore(): void
  show(): void
  focus(): void
}

export type SecondInstanceResult = 'focused' | 'shown' | 'created'

export function handleSecondInstance(opts: {
  mainWindow: WindowLike | null | undefined
  allWindows: WindowLike[]
  createWindow: () => void
}): SecondInstanceResult {
  const usable = opts.allWindows.filter((w) => !w.isDestroyed())
  const candidate = opts.mainWindow && !opts.mainWindow.isDestroyed() ? opts.mainWindow : usable[0]
  if (!candidate) {
    opts.createWindow()
    return 'created'
  }
  const wasHidden = !candidate.isVisible()
  if (candidate.isMinimized()) candidate.restore()
  if (wasHidden) candidate.show()
  candidate.focus()
  return wasHidden ? 'shown' : 'focused'
}
