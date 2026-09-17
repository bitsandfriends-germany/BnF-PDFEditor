// Generiert src/shared/commandCatalog.gen.ts — die REINE Datenansicht der Command-Registry
// (id, labelKey, group, destructive, shortcutId, order) OHNE Store-Importe, damit der
// Main-Prozess die Menü-Bar daraus bauen kann (§6: eine Quelle, keine zweite Aktions-Kopie).
// Aufruf: node scripts/command-catalog.mjs   |   Frische-Guard: tests/shared/commandCatalog.test.ts
import { readFileSync, writeFileSync } from 'node:fs'
import path from "node:path"
import { fileURLToPath } from "node:url"

const CMD = path.join(process.cwd(), 'src', 'renderer', 'lib', 'commands.ts')
const OUT = path.join(process.cwd(), 'src', 'shared', 'commandCatalog.gen.ts')

export function buildCatalogSource(src) {
  const defs = []
  for (const line of src.split('\n')) {
    const m = /^\s*\{ id: '([a-zA-Z0-9.]+)'/.exec(line)
    if (!m) continue
    const id = m[1]
    const labelKey = /labelKey: '([^']+)'/.exec(line)?.[1] ?? id
    const group = /group: '([a-zA-Z]+)'/.exec(line)?.[1] ?? 'global'
    const shortcutId = /shortcutId: '([^']+)'/.exec(line)?.[1] ?? null
    const order = Number(/order: (\d+)/.exec(line)?.[1] ?? 0)
    const destructive = /destructive: true/.test(line)
    defs.push({ id, labelKey, group, order, ...(destructive ? { destructive: true } : {}), ...(shortcutId ? { shortcutId } : {}) })
  }
  const header = `// GENERIERT aus src/renderer/lib/commands.ts — NICHT von HAND EDITIEREN.\n` +
    `// Neu erzeugen: node scripts/command-catalog.mjs   (Frische erzwingt tests/shared/commandCatalog.test.ts)\n` +
    `export interface CatalogCommand { id: string; labelKey: string; group: string; order: number; destructive?: boolean; shortcutId?: string }\n`
  return header + `export const COMMAND_CATALOG: readonly CatalogCommand[] = ` + JSON.stringify(defs, null, 1) + ` as const\n`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = readFileSync(CMD, 'utf8')
  writeFileSync(OUT, buildCatalogSource(src), 'utf8')
  console.log('commandCatalog.gen.ts geschrieben')
}
