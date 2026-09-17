#!/usr/bin/env node
// R75 Guard: Jede Funktion muss einen Hover-Hilfetext haben ("gib ALLEN Funktionen Tooltips").
//
// Geprueft wird deterministisch gegen den Quellbaum:
//   1. Jeder Befehl der zentralen Registry besitzt in DE und EN einen Text unter 'tip.cmd.<id>'.
//   2. Jede in src/renderer/lib/tooltips.ts gelistete Shell-Kontrolle hat Texte unter
//      'tip.shell.<testid>' — und die testid kommt im Quellbaum wirklich vor (keine Leichen).
//   3. Die Tooltip-Schalter-Texte der Einstellungen existieren (an/aus muss beschriftet sein).
// Exitcode 1 mit Klartextliste, sobald etwas fehlt.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const de = JSON.parse(read('src/renderer/locales/de.json'))
const en = JSON.parse(read('src/renderer/locales/en.json'))

const errors = []

// 1) Befehle aus der Registry
const commandsSrc = read('src/renderer/lib/commands.ts')
const commandIds = [...commandsSrc.matchAll(/\{ id: '([^']+)', labelKey/g)].map((m) => m[1])
for (const id of commandIds) {
  for (const [lang, dict] of [['de', de], ['en', en]]) {
    if (!dict[`tip.cmd.${id}`]) errors.push(`Befehl ${id}: tip.cmd.${id} fehlt (${lang})`)
  }
}

// 2) Shell-Kontrollen aus tooltips.ts
const tooltipsSrc = read('src/renderer/lib/tooltips.ts')
const shellEntries = [...tooltipsSrc.matchAll(/'([^']+)': 'tip\.shell\.([^']+)'/g)].map((m) => ({ testid: m[1], key: m[2] }))
const allSource = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(p)) allSource.push(readFileSync(p, 'utf8'))
  }
}
walk(join(root, 'src'))
const sourceBlob = allSource.join('\n')
for (const { testid, key } of shellEntries) {
  for (const [lang, dict] of [['de', de], ['en', en]]) {
    if (!dict[`tip.shell.${key}`]) errors.push(`Kontrolle ${testid}: tip.shell.${key} fehlt (${lang})`)
  }
  if (!sourceBlob.includes(`"${testid}"`) && !sourceBlob.includes(`'${testid}'`) && !sourceBlob.includes(`\`${testid}\``) && !sourceBlob.includes(testid)) {
    errors.push(`Kontrolle ${testid}: testid kommt im Quellbaum nicht vor (Leiche in tooltips.ts)`)
  }
}

// 3) Einstellungs-Texte fuer den Tooltip-Schalter
for (const key of ['settings.tooltips', 'settings.tooltips.hint', 'settings.rendering', 'settings.render.auto', 'settings.render.gpu', 'settings.render.software', 'settings.render.hint']) {
  for (const [lang, dict] of [['de', de], ['en', en]]) {
    if (!dict[key]) errors.push(`Einstellungen: ${key} fehlt (${lang})`)
  }
}

if (errors.length > 0) {
  console.error(`FEHLER: ${errors.length} fehlende Tooltip-Texte:`)
  for (const e of errors.slice(0, 40)) console.error(`  - ${e}`)
  if (errors.length > 40) console.error(`  … ${errors.length - 40} weitere`)
  process.exit(1)
}
console.log(`OK: ${commandIds.length} Befehle + ${shellEntries.length} Shell-Kontrollen haben in DE und EN einen Hover-Hilfetext.`)
