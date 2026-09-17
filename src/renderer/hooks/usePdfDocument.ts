import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/apiClient'
import { openDocumentFromBytes, type PDFDocumentProxy } from '@/lib/pdfjs'
import { useAppStore } from '@/store/useAppStore'

export type PdfDocStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PdfDocumentState {
  doc: PDFDocumentProxy | null
  status: PdfDocStatus
  error?: string
}

// Laedt die PDF-Arbeitskopie ueber den getypten Client (Bytes) und oeffnet sie in pdfjs.
// Schluessel ist (docOpen, docVersion): nach jeder Mutation laedt der naechste Zyklus neu.
// Die Vorgaenger-Instanz wird nach dem Swap destroyed, um Worker-/Buffer-Leaks zu vermeiden.
export function usePdfDocument(): PdfDocumentState & { reload: () => void } {
  const docOpen = useAppStore((s) => s.docOpen)
  const docVersion = useAppStore((s) => s.docVersion)
  const [state, setState] = useState<PdfDocumentState>({ doc: null, status: 'idle' })

  useEffect(() => {
    if (!docOpen) {
      setState({ doc: null, status: 'idle' })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading' }))
    void (async () => {
      try {
        const bytes = await api.getBytes('/document/file')
        const task = openDocumentFromBytes(bytes)
        const doc = await task.promise
        if (cancelled) {
          void doc.destroy()
          return
        }
        setState((s) => {
          const prev = s.doc
          if (prev && prev !== doc) void prev.destroy()
          return { doc, status: 'ready' }
        })
      } catch (err) {
        if (!cancelled) setState({ doc: null, status: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docOpen, docVersion])

  const reload = useCallback(() => useAppStore.getState().bumpDocVersion(), [])
  return { ...state, reload }
}
