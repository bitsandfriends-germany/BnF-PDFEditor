import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePdfPageRender } from '@/hooks/usePdfPageRender'
import { canvasSizeFor } from '@/lib/pdfjs'

// §4: Canvas-Backing-Store == viewport.width * devicePixelRatio (logische CSS-Größe bleibt
// viewport.width/height). Eine Diskrepanz dieser beiden ist die häufigste Ursache des Symptoms
// "Container passt nicht zur gerenderten Seite".

function setDpr(v: number) {
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: v })
}
afterEach(() => setDpr(1))

interface Captured { transform?: number[]; viewport?: { width: number; height: number } }

function fakeDoc(capture: Captured[]) {
  const page = {
    getViewport: ({ scale, rotation }: { scale: number; rotation?: number }) => ({
      width: 300 * scale,
      height: 400 * scale,
      rotation: rotation ?? 0,
      scale,
    }),
    render: (params: Captured) => {
      capture.push(params)
      return { promise: Promise.resolve(), cancel: () => undefined }
    },
  }
  return { getPage: async () => page }
}

async function renderAt(scale: number) {
  const capture: Captured[] = []
  const canvas = document.createElement('canvas')
  ;(canvas as unknown as { getContext: unknown }).getContext = () => ({}) // jsdom ohne canvas-2d
  const doc = fakeDoc(capture)                 // STABILE Identität: neues Objekt pro Render = Endlos-Loop
  const canvasRef = { current: canvas }
  const { result } = renderHook(() =>
    usePdfPageRender({ doc: doc as never, pageNumber: 1, scale, canvasRef }))
  await waitFor(() => expect(result.current.status).toBe('done'))
  return { canvas, state: result.current, captured: capture[0] as Captured }
}

describe('usePdfPageRender — Backing-Store vs. CSS-Mass (§4)', () => {
  it('dpr 1: Backing == CSS == viewport (logisch)', async () => {
    setDpr(1)
    const { canvas, state, captured } = await renderAt(1)
    expect(canvas.width).toBe(300)
    expect(canvas.height).toBe(400)
    expect(state.cssWidth).toBe(300)   // CSS bleibt logisch
    expect(state.cssHeight).toBe(400)
    expect(captured.transform).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('dpr 2: Backing Store das Doppelte, CSS-Größe bleibt logisch', async () => {
    setDpr(2)
    const { canvas, state, captured } = await renderAt(1)
    expect(canvas.width).toBe(600)     // viewport.width * dpr
    expect(canvas.height).toBe(800)
    expect(state.cssWidth).toBe(300)   // NICHT skaliert — CSS bleibt logisch (§4-Kernregel)
    expect(captured.transform).toEqual([2, 0, 0, 2, 0, 0])
    expect(captured.viewport?.width).toBe(300) // Viewport selbst ist dpr-frei
  })

  it('dpr 2 mit Zoom 1.5: Backing == round(300*1.5*2), CSS == 450', async () => {
    setDpr(2)
    const { canvas, state } = await renderAt(1.5)
    expect(canvas.width).toBe(Math.floor(450 * 2))
    expect(state.cssWidth).toBe(450)
  })

  it('canvasSizeFor: exakte ×dpr-Beziehung für dpr 1 und 2 (Modell-Helfer)', () => {
    const a = canvasSizeFor(595, 842, 1, 1)
    const b = canvasSizeFor(595, 842, 1, 2)
    expect(b.width).toBe(a.width * 2)
    expect(b.height).toBe(a.height * 2)
    const c = canvasSizeFor(595, 842, 0.4, 2)
    expect(c.width).toBe(canvasSizeFor(595, 842, 0.4, 1).width * 2)
  })
})
