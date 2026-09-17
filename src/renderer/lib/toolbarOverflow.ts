// PART 3 §5 — Überlauf-Modell der Seiten-Werkzeugleiste. Reine Funktion, damit die Zeilen-Logik
// ohne Browser messbar ist: die Leiste bricht NIE um; passt eine Gruppe nicht mehr komplett, zieht
// sie VOLLSTÄNDIG in den Überlauf-Button am Zeilenende. Gruppen werden niemals intern getrennt.
//
// Breite: feste, aus dem UI bekannte Metrik (Icon 16 + padding 2×6 = 28 pro Knopf, 4 Abstand,
// 9 Separator zwischen Gruppen, 40 Reservierung für den Überlauf-Knopf, wenn überhaupt etwas
// überläuft). Das Maß ist konservativ genug, damit echte Knöpfe nie in eine zweite Zeile rutschen.

import type { CommandDef, ToolbarGroup } from '@/lib/commands'

export const BTN_W = 28
export const BTN_GAP = 4
export const SEP_W = 9
export const OVERFLOW_W = 40

export interface ToolbarLayout {
  inline: ToolbarGroup[]
  overflow: ToolbarGroup[]
}

export function groupWidth(items: CommandDef[]): number {
  if (items.length === 0) return 0
  return items.length * BTN_W + (items.length - 1) * BTN_GAP
}

// groupWidths: Map Gruppe -> aktive Items (nur Gruppen mit Einträgen zählen).
export function toolbarLayout(groupWidths: ReadonlyMap<ToolbarGroup, CommandDef[]>, available: number): ToolbarLayout {
  const entries = [...groupWidths.entries()].filter(([, items]) => items.length > 0)
  const total = (gs: ToolbarGroup[]): number =>
    gs.reduce((w, g) => w + groupWidth(groupWidths.get(g) ?? []), 0) +
    Math.max(0, gs.length - 1) * SEP_W
  if (entries.length === 0 || total(entries.map(([g]) => g)) <= available) {
    return { inline: entries.map(([g]) => g), overflow: [] }
  }
  const need = available - OVERFLOW_W
  const inline: ToolbarGroup[] = []
  for (const [g] of entries) {
    const next = [...inline, g]
    if (total(next) > need) break
    inline.push(g)
  }
  return { inline, overflow: entries.map(([g]) => g).filter((g) => !inline.includes(g)) }
}

// Eintrag für den Überlauf-Kontextmenü-Renderer (identisch zur Struktur von contextMenuFor, damit
// dasselbe getestete Menü die ausgezogenen Gruppen zeigt — keine zweite Menü-Implementierung).
export interface OverflowMenuModel {
  primary: CommandDef[]
  destructive: CommandDef[]
}

export function overflowMenuModel(overflow: readonly ToolbarGroup[], byGroup: (g: ToolbarGroup) => CommandDef[]): OverflowMenuModel {
  const all = overflow.flatMap((g) => byGroup(g))
  return { primary: all.filter((c) => !c.destructive), destructive: all.filter((c) => c.destructive) }
}
