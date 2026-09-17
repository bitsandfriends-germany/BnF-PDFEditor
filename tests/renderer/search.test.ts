import { describe, it, expect } from 'vitest'
import { foldString, findMatchesInText, searchPages } from '@/lib/search'

// Section 5: Such-Matcher. Diakritik-insensitiv ist Pflicht (Deutsch), Indizes muessen auf den
// Ursprungstext zeigen (fuer spaeteres Highlighting).

describe('foldString', () => {
  it('diakritik-insensitiv + lowercase (Default), 1:1-Laenge', () => {
    expect(foldString('Grundstück')).toBe('grundstuck')
    // ß ist kein Kombinationssymbol -> bleibt erhalten; nur Akzente falten, Laenge bleibt 1:1.
    expect(foldString('Größe')).toBe('große')
    expect(foldString('ÄÖÜ').length).toBe(3)
  })
  it('caseSensitive erhaelt Gross/Klein', () => {
    expect(foldString('ÄÖÜ', { caseSensitive: true })).toBe('AOU')
  })
})

describe('findMatchesInText', () => {
  it('findet Grundstuck -> Grundstueck mit korrektem Ursprungsindex', () => {
    const text = 'Ein Grundstück hier'
    const m = findMatchesInText(text, 'Grundstuck')
    expect(m).toHaveLength(1)
    expect(text.slice(m[0]!.start, m[0]!.end)).toBe('Grundstück')
  })
  it('Index zeigt korrekt, wenn vor dem Treffer Umlaute stehen', () => {
    const text = 'ÄÖÜ Stück'
    const m = findMatchesInText(text, 'stück')
    expect(m).toHaveLength(1)
    expect(text.slice(m[0]!.start, m[0]!.end)).toBe('Stück')
  })
  it('Gross-/Kleinschreibung', () => {
    expect(findMatchesInText('abc ABC', 'abc')).toHaveLength(2)
    expect(findMatchesInText('abc ABC', 'abc', { caseSensitive: true })).toHaveLength(1)
  })
  it('Ganzes Wort', () => {
    expect(findMatchesInText('Katze Katzen', 'Katze')).toHaveLength(2)
    expect(findMatchesInText('Katze Katzen', 'Katze', { wholeWord: true })).toHaveLength(1)
  })
  it('leere Query -> keine Treffer', () => {
    expect(findMatchesInText('text', '')).toHaveLength(0)
  })
  it('keine ueberlappenden Treffer', () => {
    expect(findMatchesInText('aaaa', 'aa')).toHaveLength(2)
  })
})

describe('searchPages', () => {
  it('meldet Seiten ohne Textebene als noTextPages, nicht als 0 Treffer', () => {
    const hit = searchPages(
      [
        { page: 1, text: 'Hallo Welt' },
        { page: 2, text: null },
        { page: 3, text: '   ' }
      ],
      'welt'
    )
    expect(hit.matches).toEqual([{ page: 1, start: 6, end: 10 }])
    expect(hit.noTextPages).toEqual([2, 3])
  })
  it('Treffer ueber mehrere Seiten, nach Seite sortiert', () => {
    const hit = searchPages(
      [
        { page: 2, text: 'apfel' },
        { page: 1, text: 'Apfel' }
      ],
      'apfel'
    )
    expect(hit.matches.map((m) => m.page)).toEqual([1, 2])
  })
  it('leere Query -> leer', () => {
    expect(searchPages([{ page: 1, text: 'x' }], '').matches).toHaveLength(0)
  })
})
