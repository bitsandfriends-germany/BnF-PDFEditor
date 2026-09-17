// Textsuche (Section 5). Reiner, index-treuer Matcher. Diakritik-insensitiv ist Pflicht fuer
// Deutsch: "Grundstuck" findet "Grundstueck"/"Grundstück". Das Folding bleibt pro Zeichn 1:1
// (entfernte Kombinationen werden je Zeichn ersetzt, nicht angehaengt), damit gefundene Indizes
// exakt auf den Ursprungstext zeigen und fuer Highlighting/Snippets wiederverwendbar sind.

export interface SearchOptions {
  caseSensitive?: boolean // Default false
  wholeWord?: boolean // Default false
  diacriticInsensitive?: boolean // Default true
}

export interface Match {
  page: number // 1-basiert
  start: number // Index im Seitentext (UTF-16, folding-getreu)
  end: number
}

export interface PageText {
  page: number
  text: string | null // null => keine Textebene (Scan)
}

export interface SearchHit {
  matches: Match[]
  noTextPages: number[] // Seiten ohne Textebene -> Panel weist auf OCR hin statt 0 Treffer
}

const COMBINING = /[\u0300-\u036f]/
// Word-Char fuer Ganzwort-Pruefung: Buchstaben (inkl. Umlaute), Ziffern, Underscore.
const WORD = /[0-9A-Za-zÄÖÜäöüß_]/

function foldChar(c: string, diacritic: boolean, lower: boolean): string {
  let out = c
  if (diacritic && out.charCodeAt(0) > 127) {
    const f = out.normalize('NFD').replace(COMBINING, '')
    if (f.length === 1) out = f // nur bei 1:1-Laenge, sonst Original behalten
  }
  if (lower) {
    const l = out.toLowerCase()
    if (l.length === 1) out = l
  }
  return out
}

// Laengen-getreues Folding: jedes Zeichn -> genau ein Zeichn, damit Indizes stabil bleiben.
export function foldString(s: string, opts: SearchOptions = {}): string {
  const diacritic = opts.diacriticInsensitive ?? true
  const lower = !(opts.caseSensitive ?? false)
  let out = ''
  for (const c of s) out += foldChar(c, diacritic, lower)
  return out
}

export function findMatchesInText(text: string, query: string, opts: SearchOptions = {}): { start: number; end: number }[] {
  if (!query) return []
  const hay = foldString(text, opts)
  const needle = foldString(query, opts)
  if (!needle) return []
  const whole = opts.wholeWord ?? false
  const res: { start: number; end: number }[] = []
  let from = 0
  for (;;) {
    const idx = hay.indexOf(needle, from)
    if (idx < 0) break
    const end = idx + needle.length
    if (whole) {
      const before = idx > 0 ? hay[idx - 1] : ''
      const after = end < hay.length ? hay[end] : ''
      if ((before && WORD.test(before)) || (after && WORD.test(after))) {
        from = idx + 1
        continue
      }
    }
    res.push({ start: idx, end })
    from = end // keine ueberlappenden Treffer
  }
  return res
}

// Suche ueber mehrere Seiten. Seiten ohne Textebene (null oder nur Whitespace) werden als
// noTextPages gemeldet, damit die UI "gescant -> OCR anbieten" statt "0 Treffer" zeigt.
export function searchPages(pages: PageText[], query: string, opts: SearchOptions = {}): SearchHit {
  const matches: Match[] = []
  const noTextPages: number[] = []
  if (!query) return { matches, noTextPages }
  // Treffer folgen der Seitenreihenfolge (dann Textoffset), fuer next/prev-Sinnfaelligkeit.
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    if (p.text === null || p.text.trim() === '') {
      noTextPages.push(p.page)
      continue
    }
    for (const m of findMatchesInText(p.text, query, opts)) matches.push({ page: p.page, start: m.start, end: m.end })
  }
  return { matches, noTextPages }
}
