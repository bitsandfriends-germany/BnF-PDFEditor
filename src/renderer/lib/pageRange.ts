// Spiegel des Backend-Seitenbereichs-Parsers (backend/pages.py) fuer Live-Validierung im
// Renderer. SYSTEM PROMPT PART 2, Section 3. Beide Implementierungen werden von derselben
// Konformitaetstabelle tests/pagerange.table.json getrieben — die Semantik muss identisch sein.
//
// Grammatik: 5 | 3-9 | 7- | -4 | all/odd/even/last/last-N | fuehrendes '!' = Komplement.
// 1-basiert, inklusiv, Duplikate kollabieren (Reihenfolge des ersten Auftretens bleibt),
// ausserhalb des Bereichs = Fehler (nie stiller Clamp).

export type PageRangeResult = { ok: true; pages: number[] } | { ok: false; error: string }

const INT_RE = /^\d+$/

function validRangeMsg(total: number): string {
  return total >= 1 ? `gueltiger Bereich 1-${total}` : 'Dokument enthaelt keine Seiten'
}

/** parsePageRange prueft eine Eingabe und liefert die expandierten Seitenzahlen oder einen Fehler. */
export function parsePageRange(expr: string, total: number): PageRangeResult {
  const fail = (error: string): PageRangeResult => ({ ok: false, error })

  if (total < 1) return fail(`Dokument enthaelt keine Seiten (${validRangeMsg(total)})`)

  let s = (expr ?? '').trim()
  if (!s) return fail(`Seitenbereich ist leer; ${validRangeMsg(total)}`)

  let negate = false
  if (s.startsWith('!')) {
    negate = true
    s = s.slice(1).trim()
    if (!s) return fail(`Seitenbereich nach '!' ist leer; ${validRangeMsg(total)}`)
  }

  const order: number[] = []
  const seen = new Set<number>()
  const add = (n: number): void => {
    if (!seen.has(n)) {
      seen.add(n)
      order.push(n)
    }
  }

  // Eine explizite Zahlengrenze; ausserhalb [1,total] ist ein Fehler (kein Clamp).
  type Bound = { ok: true; value: number } | { ok: false; error: string }
  const parseBound = (raw: string): Bound => {
    const t = raw.trim()
    if (!INT_RE.test(t)) return { ok: false, error: `Ungueltige Seitenzahl '${t || raw}'; ${validRangeMsg(total)}` }
    const v = Number.parseInt(t, 10)
    if (v < 1 || v > total) return { ok: false, error: `Seite ${v} liegt außerhalb des gültigen Bereichs 1-${total}` }
    return { ok: true, value: v }
  }

  const expandTerm = (term: string): { error: string } | null => {
    const low = term.trim().toLowerCase()

    if (low === 'all') { for (let n = 1; n <= total; n++) add(n); return null }
    if (low === 'odd') { for (let n = 1; n <= total; n += 2) add(n); return null }
    if (low === 'even') { for (let n = 2; n <= total; n += 2) add(n); return null }
    if (low === 'last') { add(total); return null }
    if (low.startsWith('last-')) {
      const nstr = low.slice('last-'.length)
      if (!INT_RE.test(nstr)) return { error: `Ungueltiges 'last-${nstr}'; erwartet positive Zahl` }
      const count = Number.parseInt(nstr, 10)
      if (count < 1) return { error: `Ungueltiges 'last-${count}'; erwartet Zahl >= 1` }
      for (let n = Math.max(1, total - count + 1); n <= total; n++) add(n)
      return null
    }

    if (term.includes('-')) {
      const parts = term.split('-')
      if (parts.length !== 2) return { error: `Ungueltiger Bereich '${term.trim()}'` }
      const aRaw = (parts[0] ?? '').trim()
      const bRaw = (parts[1] ?? '').trim()
      if (aRaw === '' && bRaw === '') return { error: `Ungueltiger Bereich '${term.trim()}'` }
      let start = 1
      let end = total
      if (aRaw !== '') {
        const r = parseBound(aRaw)
        if (!r.ok) return { error: r.error }
        start = r.value
      }
      if (bRaw !== '') {
        const r = parseBound(bRaw)
        if (!r.ok) return { error: r.error }
        end = r.value
      }
      if (start > end) return { error: `Umgekehrter Bereich '${term.trim()}'; Start muss <= Ende sein` }
      for (let n = start; n <= end; n++) add(n)
      return null
    }

    const r = parseBound(term)
    if (!r.ok) return { error: r.error }
    add(r.value)
    return null
  }

  for (const rawTerm of s.split(',')) {
    const term = rawTerm.trim()
    if (!term) return fail(`Leerer Eintrag im Seitenbereich; ${validRangeMsg(total)}`)
    const err = expandTerm(term)
    if (err) return fail(err.error)
  }

  let result: number[]
  if (negate) {
    result = []
    for (let n = 1; n <= total; n++) if (!seen.has(n)) result.push(n)
  } else {
    result = order
  }

  if (result.length === 0) return fail(`Der Seitenbereich ist leer; ${validRangeMsg(total)}`)
  return { ok: true, pages: result }
}

/** Convenience fuer Reihenfolge-unabhaengige Operationen (Loeschen/Rotieren). */
export function parsePageRangeSet(expr: string, total: number): PageRangeResult {
  const r = parsePageRange(expr, total)
  if (!r.ok) return r
  return { ok: true, pages: Array.from(new Set(r.pages)).sort((a, b) => a - b) }
}
