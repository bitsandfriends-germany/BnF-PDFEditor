import * as fs from 'node:fs'
import * as path from 'node:path'

// Rotation nach Section 6: "Rotation at 10 MB, at most 5 files."
// electron-log ruft archiveLogFn(oldLogFile), sobald debug.jsonl die maxSize ueberschreitet.
// Wir verschieben in eine nummerierte Archivkette debug.jsonl.1 ... debug.jsonl.<max-1>
// und loeschen das älteste, damit die Gesamtzahl der Dateien (aktive + Archive) <= maxFiles bleibt.

export const ROTATION = {
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxFiles: 5 // inklusive der aktiven debug.jsonl
} as const

export type RotationOp =
  | { kind: 'delete'; target: string }
  | { kind: 'rename'; from: string; to: string }

// Archivierte Datei zu Index i: debug.jsonl.1 (neuestes Archiv) ... je hoeher, desto aelter.
function archiveName(activePath: string, index: number): string {
  return `${activePath}.${index}`
}

// Reine Planung: gegeben die aktive Datei und die Archivnamen, die aktuell existieren,
// liefere die Operationen in Ausfuehrungsreihenfolge. maxFiles schliesst die aktive Datei ein.
export function planRotation(activePath: string, existingArchives: number[], maxFiles: number): RotationOp[] {
  const maxArchives = Math.max(0, maxFiles - 1)
  const ops: RotationOp[] = []
  if (maxArchives === 0) {
    // Kein Platz fuer Archive: aktive Datei verwerfen und frisch beginnen.
    ops.push({ kind: 'delete', target: activePath })
    return ops
  }
  // aeltestes Archiv (Index maxArchives) hat keinen Platz mehr, wenn es existiert
  const oldest = archiveName(activePath, maxArchives)
  if (existingArchives.includes(maxArchives)) ops.push({ kind: 'delete', target: oldest })
  // Kettenverschiebung von alt nach neu: i -> i+1, absteigend, damit keine Ueberschreibung klemmt
  for (let i = maxArchives - 1; i >= 1; i--) {
    if (existingArchives.includes(i)) {
      ops.push({ kind: 'rename', from: archiveName(activePath, i), to: archiveName(activePath, i + 1) })
    }
  }
  // aktive Datei wird zum neuesten Archiv Index 1
  ops.push({ kind: 'rename', from: activePath, to: archiveName(activePath, 1) })
  return ops
}

export function collectExistingArchives(dir: string, activeFileName: string): number[] {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const prefix = `${activeFileName}.`
  const indices: number[] = []
  for (const name of names) {
    if (name.startsWith(prefix)) {
      const suffix = name.slice(prefix.length)
      if (/^\d+$/.test(suffix)) indices.push(Number(suffix))
    }
  }
  return indices
}

// Wendet den Plan synchron auf dem Dateisystem an. Rufe Fehler bewusst nach oben:
// electron-log faengt archiveLogFn intern ab und warnt, ein Log-Rotation-Fehler darf
// nie die App beenden.
export function applyRotation(activePath: string, existingArchives: number[], maxFiles: number): void {
  const ops = planRotation(activePath, existingArchives, maxFiles)
  for (const op of ops) {
    if (op.kind === 'delete') {
      fs.rmSync(op.target, { force: true })
    } else {
      fs.renameSync(op.from, op.to)
    }
  }
}

// electron-log uebergibt der archiveLogFn die aktuelle Log-Datei. Wir leiten Verzeichnis
// und Dateinamen daraus ab (Single Source of Truth) statt sie zu duplicieren.
export function makeArchiveLogFn(): (oldLogFile: { toString(): string }) => void {
  return (oldLogFile) => {
    const activePath = oldLogFile.toString()
    const dir = path.dirname(activePath)
    const fileName = path.basename(activePath)
    const existing = collectExistingArchives(dir, fileName)
    applyRotation(activePath, existing, ROTATION.maxFiles)
  }
}
