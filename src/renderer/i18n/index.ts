import { create } from 'zustand'
import de from '../locales/de.json'
import en from '../locales/en.json'

// Zentraler i18n-Layer (Section 4D). Kein sichtbarer String darf hart im Komponentencode stehen.
// Die Keysatz beider Bundles ist identisch; ein Key ist niemals selbst ein Satz in einer Sprache.

export type Lang = 'de' | 'en'

type Bundle = Record<string, string>
const BUNDLES: Record<Lang, Bundle> = { de: de as Bundle, en: en as Bundle }

// Default: Systemlocale, expliziter Fallback Deutsch (Spec).
function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2).toLowerCase() : undefined
  return nav === 'en' ? 'en' : 'de'
}

export type TParams = Record<string, string | number>

interface I18nState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useI18n = create<I18nState>()((set) => ({
  lang: detectLang(),
  setLang: (lang) => set({ lang })
}))

export function getLang(): Lang {
  return useI18n.getState().lang
}

export function setLang(lang: Lang): void {
  useI18n.getState().setLang(lang)
}

// Übersetzung + optionale {Platzhalter}-Substitution. Fehlt der Key im aktiven Bundle,
// fällt er auf Deutsch und schliesslich auf den Key selbst zurück (nie stumm leer).
export function t(key: string, params?: TParams): string {
  const active = BUNDLES[useI18n.getState().lang] ?? BUNDLES.de
  const template = active[key] ?? BUNDLES.de[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = params[k]
    return v === undefined ? '' : String(v)
  })
}

// Hook-Variante: abonniert die Sprache, damit Komponenten bei Wechsel neu rendern.
export function useT(): (key: string, params?: TParams) => string {
  const lang = useI18n((s) => s.lang)
  void lang // Der Selector-Aufruf allein abonniert 'lang' und löst Re-Render aus.
  return t
}

// Mappt einen stabilen Backend-/AI-Fehlercode auf eine menschenlesbare Meldung.
// 'unauthorized' und Netzwerkfehler bekommen eigene Keys; sonst fallback.
export function errorMessage(code: string | undefined, fallbackKey = 'errors.fallback'): string {
  if (!code) return t(fallbackKey)
  const key = `errors.${code}`
  const active = BUNDLES[useI18n.getState().lang] ?? BUNDLES.de
  if (key in active || key in BUNDLES.de) return t(key)
  return t(fallbackKey)
}
