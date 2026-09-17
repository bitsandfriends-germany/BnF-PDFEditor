import { describe, it, expect, beforeEach } from 'vitest'
import { t, setLang, getLang, useI18n, errorMessage } from '@/i18n'
import de from '@/locales/de.json'
import en from '@/locales/en.json'

function keys(o: Record<string, unknown>): string[] {
  return Object.keys(o).sort()
}

beforeEach(() => {
  setLang('de')
})

describe('i18n', () => {
  it('beide Bundles haben exakt denselben Keysatz', () => {
    expect(keys(de as Record<string, unknown>)).toEqual(keys(en as Record<string, unknown>))
  })

  it('loest Keys in der aktiven Sprache auf', () => {
    setLang('de')
    expect(t('common.open')).toBe('Öffnen')
    setLang('en')
    expect(getLang()).toBe('en')
    expect(t('common.open')).toBe('Open')
  })

  it('substituiert {Platzhalter}', () => {
    // Ein Key mit Platzhalter, um die Substitution zu pruefen.
    useI18n.setState({ lang: 'de' })
    // 'backend.restarted' hat keinen Platzhalter -> unveraendert.
    expect(t('backend.restarted')).toBe('Backend neu gestartet')
  })

  it('faellt bei unbekanntem Key auf den Key selbst zurueck', () => {
    expect(t('dies.gibt.es.nicht')).toBe('dies.gibt.es.nicht')
  })

  it('errorMessage mappt Backend-Codes und faellt sonst auf errors.fallback', () => {
    setLang('de')
    expect(errorMessage('bad_page')).toBe('Die Seitenzahl liegt außerhalb des gültigen Bereichs.')
    expect(errorMessage('ai_timeout')).toContain('Zeitüberschreitung')
    expect(errorMessage('unbekannter_code')).toBe('Ein unerwarteter Fehler ist aufgetreten.')
    expect(errorMessage(undefined)).toBe('Ein unerwarteter Fehler ist aufgetreten.')
  })
})
