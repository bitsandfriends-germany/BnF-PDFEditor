import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from '@/lib/pdfjs'

// Basisgröße der aktuellen Seite bei scale=1 (in PDF-Punkten, rotationsbereinigt ueber das Viewport).
// Wird fuer Fit Width / Fit Page bentoetigt. Haelt die Viewport-Konvention von pdfjs ein.

export function usePageSize(doc: PDFDocumentProxy | null, pageNumber: number, docVersion: number): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    if (!doc) {
      setSize(null)
      return
    }
    let alive = true
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        const vp = page.getViewport({ scale: 1 })
        if (alive) setSize({ width: vp.width, height: vp.height })
      } catch {
        if (alive) setSize(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [doc, pageNumber, docVersion])
  return size
}
