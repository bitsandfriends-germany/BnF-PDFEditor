// Reine Virtualisierungslogik fuer die Thumbnail-Leiste (Section 4B Tab1: nur sichtbare Seiten
// rendern, sonst brechen 500+ Seiten den Renderer). Kein DOM, kein pdfjs -> vollstaendig testbar.

export interface WindowRange {
  start: number // inklusiv
  end: number // exklusiv
}

// Sichtbares Indexfenster [start,end) bei vertikaler Liste mit gleichmaessiger Zeilenhoehe.
export function thumbnailWindow(
  total: number,
  scrollTop: number,
  viewHeight: number,
  itemStride: number,
  overscan = 4
): WindowRange {
  if (total <= 0 || itemStride <= 0) return { start: 0, end: 0 }
  const first = Math.max(0, Math.floor(scrollTop / itemStride) - overscan)
  const last = Math.min(total - 1, Math.ceil((scrollTop + viewHeight) / itemStride) - 1 + overscan)
  return { start: first, end: last + 1 }
}
