// §7.1: Die Verifikations-Matrix MUSS aus der Command-Registry gebaut sein, damit Tabelle und
// Interface nicht auseinanderdriften. Liest die ids aus src/renderer/lib/commands.ts (einzige
// Quelle der Reihenfolge) und prüft, dass der MARKIERTE ABSCHNITT in docs/verification-matrix.md
// genau diese ids als Tabellenzeilen enthält — und jede Zeile eine Beweisspalte hat.
// Aufruf: node scripts/verification-matrix.mjs   (Fehler != 0 bei Drift; der Guard-Test
// tests/renderer/matrixSync.test.ts prüft dasselbe in der Suite.)
import { readFileSync } from 'node:fs'
import path from 'node:path'

const CMD = path.join(process.cwd(), 'src', 'renderer', 'lib', 'commands.ts')
const DOC = path.join(process.cwd(), 'docs', 'verification-matrix.md')
const BEGIN = '<!-- REGISTRY-MATRIX:BEGIN -->'
const END = '<!-- REGISTRY-MATRIX:END -->'

const src = readFileSync(CMD, 'utf8')
const ids = [...src.matchAll(/\{ id: '([a-zA-Z0-9.]+)'/g)].map((m) => m[1])
if (ids.length === 0) { console.error('keine Befehle in commands.ts gefunden'); process.exit(1) }

const doc = readFileSync(DOC, 'utf8')
const b = doc.indexOf(BEGIN)
const e = doc.indexOf(END)
if (b === -1 || e === -1 || e < b) { console.error('Marker fehlen in docs/verification-matrix.md'); process.exit(1) }
const section = doc.slice(b, e)

const problems = []
for (const id of ids) {
  if (!section.includes('`' + id + '`')) problems.push(`Zeile fehlt: ${id}`)
}
const rowIds = [...section.matchAll(/^\|\s*`([a-zA-Z0-9.]+)`\s*\|/gm)].map((m) => m[1])
for (const rid of rowIds) {
  if (!ids.includes(rid)) problems.push(`Zeile ohne Registry-Befehl: ${rid}`)
}
// jede Zeile muss eine leere Beweiszelle haben? Nein: leerer Beweis == OFFEN (sichtbar, erlaubt,
// aber wir zählen ihn). Zeilen ohne "OFFEN" brauchen einen Testnamen mit ".py::" oder ".test.".
let openCount = 0
for (const m of section.matchAll(/^\|\s*`([a-zA-Z0-9.]+)`\s*\|.*\|$/gm)) {
  const line = m[0]
  if (!/\.py::|\.test\.tsx?|\.spec\.ts|OFFEN|kein Dokumenteffekt/.test(line)) problems.push(`Zeile ohne Beweismarke: ${m[1]}`)
  if (line.includes('OFFEN')) openCount++
}

if (ids.length !== rowIds.length) console.log(`Hinweis: ${ids.length} Registry-Befehle, ${rowIds.length} Zeilen`)
if (problems.length) {
  for (const p of problems) console.error('DRIFT: ' + p)
  process.exit(1)
}
console.log(`OK: ${rowIds.length} Befehle, ${openCount} mit OFFEN-Beweis, Registry == Matrix.`)
