// Erzeugt docs/ui-registry.md: alle UI-UIDs (data-testid) mit Datei:Zeile, Tag und Hinweis.
// Aufruf:  node scripts/ui-registry.mjs      (oder: npm run ui-registry)
// Quelle der Wahrheit ist der Quellcode; die Datei ist generiert und wird nicht von Hand gepflegt.
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.join(process.cwd(), 'src', 'renderer')
const OUT = path.join(process.cwd(), 'docs', 'ui-registry.md')

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(fp))
    else if (e.isFile() && fp.endsWith('.tsx')) out.push(fp)
  }
  return out
}
function openingTagEnd(src, from) {
  let d = 0, j = from
  while (j < src.length) {
    const c = src[j]
    if (c === '"') { j++; while (j < src.length && src[j] !== '"') j++ }
    else if (c === "'") { j++; while (j < src.length && src[j] !== "'") j++ }
    else if (c === '{') d++
    else if (c === '}') d--
    else if (c === '>' && d === 0) return j
    j++
  }
  return src.length
}
// moegliche Beschriftung eines Tags ableiten (aria-label / title / placeholder / t('key'))
function hintFor(tag) {
  const a = tag.match(/aria-label=\{?[`"']([^`"'\n]+)/) || tag.match(/title=\{?[`"']([^`"'\n]+)/) || tag.match(/placeholder=\{?[`"']([^`"'\n]+)/)
  if (a) return a[1].trim()
  const t = tag.match(/t\(['"]([^'"]+)['"]\)/)
  return t ? t[1] : ''
}

const CONTROL = /<(button|input|select|textarea)\b/g
const TESTID = /\sdata-testid=("[^"]+"|\{[^>]*?\})/
const rows = []
for (const fp of walk(ROOT)) {
  const src = fs.readFileSync(fp, 'utf8')
  const rel = path.relative(process.cwd(), fp)
  let m
  CONTROL.lastIndex = 0
  while ((m = CONTROL.exec(src))) {
    const end = openingTagEnd(src, m.index + m[0].length)
    const tag = src.slice(m.index, end)
    const tid = tag.match(TESTID)
    if (!tid) continue
    const raw = tid[1]
    const isDyn = raw.startsWith('{')
    const uid = isDyn ? raw.slice(1, -1).trim() : raw.slice(1, -1)
    const line = src.slice(0, m.index).split('\n').length
    rows.push({ uid, dyn: isDyn, tag: m[1], rel, line, hint: hintFor(tag) })
  }
}
// Command-Registry: pg-* UIDs (testid) sind Werte in commands.ts (nicht literals im .tsx), weil die
// Registry die EINE Quelle ist (§7.6). Fürs UID-Register von dort ableiten, damit keine UID fehlt.
{
  const cfp = path.join(ROOT, 'lib', 'commands.ts')
  if (fs.existsSync(cfp)) {
    const src = fs.readFileSync(cfp, 'utf8')
    const rel = path.relative(process.cwd(), cfp)
    const re = /labelKey:\s*'([^']+)'[^}]*?testid:\s*'([^']+)'/g
    let mm
    while ((mm = re.exec(src))) {
      const line = src.slice(0, mm.index).split('\n').length
      rows.push({ uid: mm[2], dyn: false, tag: 'button', rel, line, hint: mm[1] })
    }
  }
}
rows.sort((a, b) => (a.rel + a.line).localeCompare(b.rel + b.line))

const esc = (s) => s.replace(/\|/g, '\\|').replace(/`/g, "'")
const lines = []
lines.push('# UI‑UID‑Register (generiert)')
lines.push('')
lines.push('> Automatisch erzeugt mit `npm run ui-registry`. Nicht von Hand bearbeiten.')
lines.push('> **UID = `data-testid`.** Nenne mir eine UID, ich finde und bearbeite genau das Element.')
lines.push('> Statische UIDs sind global eindeutig. UIDs mit `${…}` sind Listen‑/Wiederhol‑Elemente (zur Laufzeit pro Eintrag eindeutig indiziert).')
lines.push('')
lines.push(`Insgesamt: **${rows.length} UID‑tragende Controls** (${rows.filter((r) => !r.dyn).length} statisch, ${rows.filter((r) => r.dyn).length} dynamisch).`)
lines.push('')
lines.push('| UID | Typ | Datei:Zeile | Hinweis |')
lines.push('|---|---|---|---|')
for (const r of rows) {
  const u = r.dyn ? `\`${esc(r.uid)}\`` : `\`${esc(r.uid)}\``
  lines.push(`| ${u} | <${r.tag}> | \`${r.rel.replace(/^src\/renderer\//, '')}:${r.line}\` | ${esc(r.hint)} |`)
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8')
console.log(`docs/ui-registry.md geschrieben: ${rows.length} UIDs (${rows.filter((r) => !r.dyn).length} statisch / ${rows.filter((r) => r.dyn).length} dynamisch)`)
