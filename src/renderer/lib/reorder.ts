// Reorder per Drag & Drop (Section 6): mehrseitige Auswahl als Block verschieben. Reine Logik,
// liefert die 0-basierte Ziel-Permutation, die der /pages/reorder-Endpunkt erwartet
// (sort(order) === [0..n-1]). Bei ungueltigem Ziel (Drop auf ein eigenes Seitenmitglied) -> null.

export function moveBlockOrder(
  pageCount: number,
  movingPages: number[], // 1-basiert, aktuelle Auswahl
  dropTarget: number | null, // 1-basierte Zielseite; null = ans Ende
  after: boolean // true = hinter die Zielseite einfuegen
): number[] | null {
  if (pageCount <= 0) return null
  const moving = Array.from(new Set(movingPages)).filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b)
  if (moving.length === 0) return null
  if (dropTarget !== null && moving.includes(dropTarget)) return null // Drop auf eigene Seite: No-Op
  const movingSet = new Set(moving)
  const fixed: number[] = []
  for (let p = 1; p <= pageCount; p++) if (!movingSet.has(p)) fixed.push(p)
  // Fall: alles ausgewaehlt -> nichts zu verschieben.
  if (fixed.length === 0) return null
  let pos: number
  if (dropTarget === null) {
    pos = fixed.length
  } else {
    const idx = fixed.indexOf(dropTarget)
    if (idx < 0) return null
    pos = after ? idx + 1 : idx
  }
  const next1 = [...fixed.slice(0, pos), ...moving, ...fixed.slice(pos)]
  return next1.map((p) => p - 1) // 0-basiert fuer den Backend-Endpunkt
}
