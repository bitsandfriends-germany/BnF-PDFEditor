// jsdom implementiert ResizeObserver nicht. Ein minimaler Polyfill, damit Shell-Komponenten,
// die den Canvas-Container vermessen, im jsdom-Umfeld ueberhaupt mounten koennen. Die Groessen-
// Rueckgabe wird bewusst nicht automatisiert ausgeloest — Fit-Zoom ist ein Laufzeit-/Playwright-Thema.
class ResizeObserverStub {
  private readonly cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(): void {
    // noop
  }
  unobserve(): void {
    // noop
  }
  disconnect(): void {
    // noop
  }
  fire(entries: ResizeObserverEntry[]): void {
    this.cb(entries, this)
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
