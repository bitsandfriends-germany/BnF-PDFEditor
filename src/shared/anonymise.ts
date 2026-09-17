// Anonymisierung fuer den KI-Diagnose-Dump (Section 6): alle Dateipfade und -namen werden durch
// stabile Tokens ersetzt. Reine Funktion, in Main UND Renderer nutzbar; sie erhaelt keine
// Rueckabbildung — das Mapping verlaesst den Prozess nie.

export interface Anonymiser {
  anonymise<T>(value: T): T
}

const PATH_UNIX = /(^|[\s"'(=])(\/(?:[^\s/"'()]+\/)*[^\s/"'()]+)/g
const PATH_WIN = /[A-Za-z]:\\(?:[^\s"'()\\]+\\)*[^\s"'()\\]+/g
const PATH_HOME = /(\/(?:home|Users|root)\/)[^/\s"']+/g
const FILE_NAME = /\b[\w][\w.-]*\.(?:pdf|png|jpg|jpeg|svg|p12|pfx|enc|json|jsonl|md|txt|py|log)\b/gi

export function createAnonymiser(home?: string): Anonymiser {
  const tokens = new Map<string, string>()
  const prefixFor = (kind: string): string => (kind === 'dir' ? 'PFAD' : 'DATEI')
  const token = (original: string, kind: 'dir' | 'file'): string => {
    const existing = tokens.get(original)
    if (existing) return existing
    const idx = tokens.size + 1
    const next = `<${prefixFor(kind)}-${idx}>`
    tokens.set(original, next)
    return next
  }

  const redactString = (input: string): string => {
    let s = input
    if (home && home.length > 1) {
      // Konkreter Home-Pfad zuerst, damit er nicht als generischer Pfad-Token untergeht.
      s = s.split(home).join('<HOME>')
    }
    s = s.replace(PATH_HOME, (_m, p1: string) => `${p1}<BENUTZER>`)
    s = s.replace(PATH_WIN, (m) => token(m, 'dir'))
    s = s.replace(PATH_UNIX, (_m, lead: string, p: string) => `${lead}${token(p, 'dir')}`)
    s = s.replace(FILE_NAME, (m) => token(m, 'file'))
    return s
  }

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return redactString(value)
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v)
      return out
    }
    return value
  }

  return {
    anonymise<T>(value: T): T {
      return walk(value) as T
    }
  }
}
