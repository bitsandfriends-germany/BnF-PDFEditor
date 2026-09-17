import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from '@/lib/pdfjs'
import type { PageDims } from '@/lib/viewerLayout'

// PART 3 §4: Seitenmaße ALLER Seiten EINMAL beim Öffnen einlesen und cachen (günstig), damit
// Fit-Width (breitesteste Seite) und Virtualisierungs-Platzhalter echte Maße nutzen statt zu
// schätzen. Anzeigemaße via getViewport({scale:1}) (enthält /Rotate). Leeres Array bis bereit.
export function useAllPageSizes(doc: PDFDocumentProxy | null, docVersion: number): PageDims[] {
  const [dims, setDims] = useState<PageDims[]>([])
  useEffect(() => {
    if (!doc) {
      setDims([])
      return
    }
    let alive = true
    void (async () => {
      try {
        const n = doc.numPages
        const out: PageDims[] = []
        for (let i = 1; i <= n; i++) {
          const page = await doc.getPage(i)
          const vp = page.getViewport({ scale: 1 })
          out.push({ w: vp.width, h: vp.height })
        }
        if (alive) setDims(out)
      } catch {
        if (alive) setDims([])
      }
    })()
    return () => {
      alive = false
    }
  }, [doc, docVersion])
  return dims
}

// R71: Zusaetzlich die UNGEDREHTEN Seitenmasse (rotation 0) samt Seitenrotation. PDF-Raum-Mathe
// (Formularfelder, Signaturfeld-Platzierung, Bildobjekte) rechnet in User-Space und braucht diese
// Werte; die Anzeige dagegen nutzt die gedrehten Masse aus useAllPageSizes.
export interface PageFlatDims extends PageDims {
  rotate: number
}

export function useAllPageFlatSizes(doc: PDFDocumentProxy | null, docVersion: number): PageFlatDims[] {
  const [dims, setDims] = useState<PageFlatDims[]>([])
  useEffect(() => {
    if (!doc) {
      setDims([])
      return
    }
    let alive = true
    void (async () => {
      try {
        const n = doc.numPages
        const out: PageFlatDims[] = []
        for (let i = 1; i <= n; i++) {
          const page = await doc.getPage(i)
          const flat = page.getViewport({ scale: 1, rotation: 0 })
          out.push({ w: flat.width, h: flat.height, rotate: ((page.rotate % 360) + 360) % 360 })
        }
        if (alive) setDims(out)
      } catch {
        if (alive) setDims([])
      }
    })()
    return () => {
      alive = false
    }
  }, [doc, docVersion])
  return dims
}
