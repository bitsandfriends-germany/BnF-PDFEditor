import { api } from '@/lib/apiClient'
import { createAnonymiser } from '@shared/anonymise'
import type { LogEntry } from '@shared/ipc'
import { useAppStore } from '@/store/useAppStore'
import { useAiStore } from '@/store/useAiStore'
import { useUiStore } from '@/store/useUiStore'

// KI-Diagnose-Dump (Section 6). Sammelt die letzten Log-Eintraege, Hardware-/Umgebungsinfo,
// Python-/Bibliotheksversionen, Docling-Praesenz, den Codegraph-Auszug und die KI-Konfiguration
// OHNE API-Key und ohne Base-URL-Zugangsdaten. Alle Dateipfade/-namen werden anonymisiert.
// Das Ergebnis ist ein fertig vorformulierter Prompt zum Einfuegen in ein LLM.

interface DebugVersions {
  python: string
  protocolVersion: string
  libraries: Record<string, string>
  doclingAvailable: boolean
}

function originOnly(u: string): string {
  try {
    const url = new URL(u)
    // Keine Zugangsdaten (user:pass@) und kein Pfad — nur Protokoll + Host + Port.
    return `${url.protocol}//${url.host}`
  } catch {
    return '<ungueltig>'
  }
}

function curatedAppState(): Record<string, unknown> {
  const a = useAppStore.getState()
  const u = useUiStore.getState()
  // bewusst KEINE originalPath/Pfade, keine Passwoerter, keine Zertifikatsdaten (Section 6).
  return {
    backendStatus: a.backendStatus,
    restartCount: a.restartCount,
    docOpen: a.docOpen,
    readOnly: a.readOnly,
    dirty: a.dirty,
    encrypted: a.encrypted,
    pageCount: a.pageCount,
    currentPage: a.currentPage,
    undoDepth: a.undoDepth,
    canUndo: a.canUndo,
    canRedo: a.canRedo,
    mutationLock: a.mutationLock,
    activeTab: u.activeTab,
    zoomMode: u.zoomMode,
    undoOnDisk: u.undoOnDisk
  }
}

function aiConfigForDump(): unknown {
  const c = useAiStore.getState().config
  if (!c) return { configured: false }
  return {
    configured: true,
    textModel: c.textModel ? { baseUrl: originOnly(c.textModel.baseUrl), model: c.textModel.model, contextWindow: c.textModel.contextWindow, temperature: c.textModel.temperature } : null,
    visionModel: c.visionModel ? { baseUrl: originOnly(c.visionModel.baseUrl), model: c.visionModel.model, enabled: c.visionModel.enabled } : null,
    docling: c.docling,
    privacy: c.privacy
    // keyStatus bewusst weggelassen; API-Keys werden nie exportiert.
  }
}

function codegraphForDump(cg: unknown): unknown {
  if (!cg || typeof cg !== 'object') return null
  const g = cg as { nodes?: unknown[]; edges?: unknown[]; contracts?: unknown[] }
  // Nur Struktur (Anzahlen + Schritte), keine Quelldateipfade — haelt den Dump klein und anonym.
  return {
    nodes: Array.isArray(g.nodes) ? g.nodes.length : 0,
    edges: Array.isArray(g.edges) ? g.edges.length : 0,
    contracts: Array.isArray(g.contracts) ? g.contracts.length : 0,
    steps: Array.isArray(g.contracts) ? [...new Set(g.contracts.map((c) => (c as { step?: number }).step).filter((x): x is number => typeof x === 'number'))].sort((a, b) => a - b) : []
  }
}

export async function buildDebugDump(): Promise<string> {
  const bridge = window.pdfEditor
  const platform = await bridge.getPlatformInfo()
  const entries = await bridge.logTail(200)
  const cg = await bridge.getCodegraph()
  let versions: DebugVersions | null = null
  try {
    versions = await api.get<DebugVersions>('/debug/versions')
  } catch {
    versions = null
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    environment: {
      platform: platform.platform,
      arch: platform.arch,
      displayServer: platform.wayland ? 'Wayland' : 'X11',
      ozoneHint: platform.ozoneHint ?? 'auto',
      electron: platform.electron,
      chrome: platform.chrome,
      node: platform.node,
      backend: versions ? { python: versions.python, protocolVersion: versions.protocolVersion, doclingAvailable: versions.doclingAvailable, libraries: versions.libraries } : 'nicht erreichbar'
    },
    aiConfig: aiConfigForDump(),
    appState: curatedAppState(),
    codegraph: codegraphForDump(cg),
    recentLogs: entries
  }

  const anon = createAnonymiser().anonymise(payload)
  const json = JSON.stringify(anon, null, 2)

  return [
    '# KI-Diagnose-Dump — PDF Editor',
    '',
    'Du bist ein erfahrener Debugger. Analysiere den folgenden anonymisierten Zustand der App',
    '"PDF Editor" und nenne die wahrscheinlichste Ursache sowie einen konkreten Fix. Antworte',
    'präzise. Alle Dateipfade/-namen sind durch stabile Tokens ersetzt; API-Keys fehlen.',
    '',
    '```json',
    json,
    '```',
    ''
  ].join('\n')
}

// Kurzform fuer die Debug-Konsole: nur die (anonymisierten) Logzeilen als Textblock.
export function formatLogLines(entries: LogEntry[]): string {
  return entries.map((e) => `${e.ts} [${e.source}/${e.level}] ${e.action}${e.correlationId ? ` cid=${e.correlationId}` : ''}`).join('\n')
}
