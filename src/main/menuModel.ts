// §6-Menü-Bar als REINES Modell: gebaut aus dem generierten Command-Katalog, jede Aktion genau
// einmal, Klick liefert nur die Befehls-id ans Fenster (Renderer dispatched über die Registry —
// der Main-Prozess kennt keine eigene Aktions-Kopie). Electron-frei, damit in vitest prüfbar.
import { COMMAND_CATALOG, type CatalogCommand } from '../shared/commandCatalog.gen'

export interface MenuItemModel { label: string; click: () => void }
export interface MenuGroupModel { label: string; items: MenuItemModel[] }

// Menü-Leisten-Struktur: Gruppen des Katalogs, zu Obermenüs gebündelt (Reihenfolge = hier).
const BARS: ReadonlyArray<{ title: string; groups: readonly string[] }> = [
  { title: 'File', groups: ['global'] },
  { title: 'Page', groups: ['rotate', 'arrange', 'insert', 'extractSplit', 'menu'] },
  { title: 'Content', groups: ['content', 'layers'] },
  { title: 'Selection', groups: ['selection'] },
  { title: 'Annotations', groups: ['annotation'] },
  { title: 'Text', groups: ['textSelection'] },
  { title: 'View', groups: ['view'] }
]

export function buildMenuModel(
  labels: Readonly<Record<string, string>>,
  send: (id: string) => void,
  catalog: readonly CatalogCommand[] = COMMAND_CATALOG
): MenuGroupModel[] {
  const bars = BARS.map((bar) => ({
    label: bar.title,
    items: catalog
      .filter((c) => bar.groups.includes(c.group))
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ label: labels[c.labelKey] ?? c.labelKey, click: () => send(c.id) }))
  })).filter((bar) => bar.items.length > 0)
  return bars
}

// Vollständigkeit: jede Katalog-zeile muss in genau einem Obermenü landen (sonst Drift).
export function catalogBarsCoverage(catalog: readonly CatalogCommand[] = COMMAND_CATALOG): { missing: string[] } {
  const grouped = new Set(BARS.flatMap((b) => b.groups))
  return { missing: catalog.filter((c) => !grouped.has(c.group)).map((c) => c.id) }
}
