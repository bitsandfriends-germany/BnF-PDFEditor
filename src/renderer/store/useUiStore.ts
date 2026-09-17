import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { LayoutMode } from '@/lib/layout'

// R60 Nutzerwunsch: Makiermodus (Hand: Ziehen = Blättern) und Textmodus (Cursor:
// Text markieren/kopieren) als explizite Werkzeuge; 'select' = Standard.
export type ViewerMode = 'select' | 'pan' | 'text'
import type { PdfRect } from '@/lib/pdfCoords'

export type PinVerifyResult = { ok: boolean; message?: string }

// R58: optionale Vor-Verifikation (PIN/Passwort wird PRUEFEN -> gruener Haken im
// Dialog -> erst dann schliesst der Dialog und die Signatur laeuft).
export type PinRequest = { title: string; body?: string; bodyKey?: string; needSigPin: boolean; verify?: (pin: string, sigPin: string | undefined) => Promise<PinVerifyResult> }
export type PinResult = { pin: string; sigPin?: string | undefined }

export type StampTool = 'image' | 'text'
export type MarkupType = 'Text' | 'FreeText' | 'Highlight' | 'Underline' | 'StrikeOut' | 'Squiggly'
export type MarkupTarget = PdfRect & { kind: MarkupType }
export type StampTarget = PdfRect & { kind: StampTool }

// Einheitlicher Grafik-Platzier-Flow (Nutzerwunsch): Datei-Drop/Signatur-Bibliothek
// -> Vorschau -> freie Region auf beliebiger Seite -> "Einbetten". Modus unterscheidet nur
// die Herkunft; eingebettet wird beides über denselben, verifizierten Stempel-Mutator.
export type GraphicPlacement = { mode: 'stamp' | 'signature'; name: string; imageB64: string; dataUrl: string; sigId?: string }
export type PlacedGraphicRect = { page: number; rect: PdfRect }
// Freiplatziertes Signaturfeld VOR der Signatur (Runde 55): verschiebbar,
// entfernbar; erst der Signierklick macht es kryptografisch fest.
export type SigFieldPlacement = { page: number; rect: PdfRect; arm: boolean }
// Selektion eines eingebetteten Bildobjekts (Move/Resize/Rotate/Delete nach Einbetten).
export type ImageObjectSel = { page: number; rect: PdfRect; rotation: number }

// Reiner UI-Zustand (Layout, Zoom, offene Dialoge) — getrennt vom Dokument-/Verlauf-Store,
// damit Zoomen/Tab-Wechsel nie die Undo-Stack-Metadaten anfasst. Zoom als Bruchteil (1 = 100 %).

export type SidebarTab = 'thumbnails' | 'outline' | 'annotations' | 'forms' | 'metadata' | 'properties' | 'signatures' | 'certificates' | 'ai'
export type ZoomMode = 'custom' | 'fitWidth' | 'fitPage'

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 8

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

export function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 1
  if (!Number.isFinite(page)) return 1
  return Math.min(pageCount, Math.max(1, Math.trunc(page)))
}

// Kontinuierlicher Zoom (Ctrl+Rad / +/−): multiplikativer Schritt, hart begrenzt (Section 4A).
export function stepZoom(z: number, dir: 1 | -1): number {
  return clampZoom(dir === 1 ? z * 1.2 : z / 1.2)
}

// Ansichtsdrehung (Section 5): NUR Anzeige, nie das Dokument. In 90°-Schritten, normalisiert 0..270.
export function normalizeRotation(deg: number): number {
  return ((deg % 360) + 360) % 360
}
export function stepViewRotation(cur: number, dir: 1 | -1): number {
  return normalizeRotation(cur + 90 * dir)
}

export type Theme = 'light' | 'dark'

// --- Thumbnail-Multi-Select (Section 6) ---------------------------------------------------
// 1-basierte Seiten. Reiner Reducer, damit die Selektions-Semantik ohne DOM testbar ist:
//  click -> nur diese Seite; ctrl -> umschalten; shift -> Bereich vom Anker (sortiert).
export type SelectMode = 'click' | 'ctrl' | 'shift'

export interface Selection {
  selected: number[]
  anchor: number | null
}

export function applySelection(prev: Selection, page: number, mode: SelectMode, total: number): Selection {
  const p = clampPage(page, total)
  if (mode === 'shift' && prev.anchor !== null) {
    const [lo, hi] = prev.anchor <= p ? [prev.anchor, p] : [p, prev.anchor]
    const range: number[] = []
    for (let i = lo; i <= hi; i++) range.push(i)
    return { selected: range, anchor: prev.anchor }
  }
  if (mode === 'ctrl') {
    const has = prev.selected.includes(p)
    const next = has ? prev.selected.filter((x) => x !== p) : [...prev.selected, p]
    return { selected: next.sort((a, b) => a - b), anchor: p }
  }
  return { selected: [p], anchor: p }
}

// Auswahl als Section-3-Ausdruck (aufsteigend komprimiert zu Komma-/Bereichsliste).
export function selectionExpr(selected: number[]): string {
  const s = [...new Set(selected)].sort((a, b) => a - b)
  if (s.length === 0) return ''
  const parts: string[] = []
  let start = s[0] as number
  let prev = s[0] as number
  for (let i = 1; i <= s.length; i++) {
    const cur = s[i]
    if (cur === prev + 1) {
      prev = cur
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    if (cur !== undefined) {
      start = cur
      prev = cur
    }
  }
  return parts.join(',')
}

interface UiState {
  activeTab: SidebarTab
  zoom: number
  zoomMode: ZoomMode
  viewerMode: ViewerMode
  setViewerMode: (mode: ViewerMode) => void
  viewRotation: number // Ansichtsdrehung in Grad (0/90/180/270) — NUR Anzeige, Section 5
  layoutMode: LayoutMode // Page-Layout (einzeln/fortlaufend/Doppelseit/Cover), Section 5
  theme: Theme // Dark Mode für die Chrome-Oberfläche (Section 5)
  invertPage: boolean // invertierte Seiten-Darstellung, rein visuell (Section 5)
  fullScreen: boolean // Vollbild-/Praesentationsmodus (Section 5)
  settingsOpen: boolean
  // R75: Tooltips (Hilfetexte bei Hover) an/aus — persistiert im Main-Prozess.
  tooltips: boolean
  /** Effektiver Render-Modus aus dem Main-Prozess (Anzeige in den Einstellungen). */
  renderInfo: { mode: 'auto' | 'gpu' | 'software'; effective: 'gpu' | 'software'; reason: string; gpuFailures: number } | null
  shortcutsOpen: boolean // Tastatur-Referenz (Section 5), aus der Binding-Tabelle generiert
  undoOnDisk: boolean // Section 3: Undo-Verlauf auf Platte (Default an)
  pageFlash: boolean // kurzes Rot auf der Seitenzahl bei ungültiger Eingabe
  selected: number[] // Multi-Select (1-basiert), Section 6
  anchor: number | null // Anker fuer Shift-Bereichsauswahl
  encryptDialog: boolean
  pagesDialog: null | 'extract' | 'split' | 'insert' | 'numbers' | 'watermark' | 'images' | 'flatten' | 'export' // Pages-/Export-Dialog (Section 6/7/12)
  // §6 Scoped-Menüeinträge: Vorbelegung für den geöffneten Dialog (z. B. "vor Seite 7 einfügen").
  pagesDialogPreset: null | { position?: 'start' | 'end' | 'before' | 'after'; page?: number; mode?: 'everyN' | 'at' | 'every' }
  recent: Array<{ path: string; lastOpened: string; exists: boolean }> // zuletzt geoeffnet (Section 4)
  // Wartet auf eine Passworteingabe im Modal; resolve(null) = Abbruch.
  pendingPassword: ((pw: string | null) => void) | null
  // Bestätigungs-Dialog (Section 2.8 Signatur-Gate u. a.); resolve(false) = Abbruch.
  pendingConfirm: { title: string; body: string; resolve: (ok: boolean) => void } | null
  // Schliessen mit ungespeicherten Aenderungen: drei Optionen (Section 4).
  pendingClose: ((choice: 'save' | 'discard' | 'cancel') => void) | null
  // Freie Platzierung (Section 7): bewaffnetes Werkzeug bzw. eingefangenes Zielrechteck.
  stampTool: StampTool | null
  stampTarget: StampTarget | null
  stampImage: { b64: string; name: string } | null
  // Grafik-Platzier-Flow (Stempel wie Signatur): bewaffnete Grafik + gezogene Region.
  graphicPlacement: GraphicPlacement | null
  sigField: SigFieldPlacement | null
  // R64: Klick auf ein Signaturfeld -> Popup mit Signaturinfos (Weltkoordinaten).
  sigInfo: { page: number; rect: PdfRect; screen: { x: number; y: number } } | null
  imageSel: ImageObjectSel | null
  setImageSel: (s: ImageObjectSel | null) => void
  placedGraphic: PlacedGraphicRect | null
  armGraphicPlacement: (p: GraphicPlacement) => void
  armSigField: (arm: boolean) => void
  setSigField: (page: number, rect: PdfRect) => void
  openSigInfo: (page: number, rect: PdfRect, screen: { x: number; y: number }) => void
  closeSigInfo: () => void
  moveSigField: (page: number, rect: PdfRect) => void
  clearSigField: () => void
  setPlacedGraphic: (page: number, rect: PdfRect) => void
  clearGraphicPlacement: () => void
  // Freie Annotations-Platzierung (Section 8): bewaffneter Typ bzw. eingefangenes Zielrechteck.
  // §11: Formularfelder im Seitenlayout hervorheben (Anzeige, kein Dokumenteingriff).
  highlightFormFields: boolean
  setHighlightFormFields: (on: boolean) => void
  markupTool: MarkupType | null
  markupTarget: MarkupTarget | null
  markupAuthor: string
  // §8.c: ausgewaehlte Annotation + laufende Neupositionierung (per Overlay-Rechteck).
  selectedAnnotationId: string | null
  setSelectedAnnotationId: (id: string | null) => void
  repositionAnnotationId: string | null
  armReposition: (id: string | null) => void
}

interface UiActions {
  setActiveTab: (t: SidebarTab) => void
  setZoom: (z: number, mode?: ZoomMode) => void
  zoomIn: () => void
  zoomOut: () => void
  rotateView: (dir: 1 | -1) => void
  resetViewRotation: () => void
  setLayoutMode: (m: LayoutMode) => void
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  toggleInvertPage: () => void
  setFullScreen: (v: boolean) => void
  toggleFullScreen: () => void
  openSettings: () => void
  closeSettings: () => void
  openShortcuts: () => void
  closeShortcuts: () => void
  setUndoOnDisk: (v: boolean) => void
  setTooltips: (v: boolean) => void
  setRenderInfo: (info: UiState['renderInfo']) => void
  /** Einstellungen aus dem Main-Prozess laden (Render-Modus + Tooltips). */
  loadAppSettings: () => Promise<void>
  flashPage: () => void
  selectPage: (page: number, mode: SelectMode, total: number) => void
  selectAllPages: (total: number) => void
  clearSelection: () => void
  openEncryptDialog: () => void
  closeEncryptDialog: () => void
  openPagesDialog: (kind: 'extract' | 'split' | 'insert' | 'numbers' | 'watermark' | 'images' | 'flatten' | 'export', preset?: { position?: 'start' | 'end' | 'before' | 'after'; page?: number; mode?: 'everyN' | 'at' | 'every' }) => void
  closePagesDialog: () => void
  armStamp: (kind: StampTool) => void
  captureStamp: (r: PdfRect) => void
  cancelStamp: () => void
  setStampImage: (img: { b64: string; name: string } | null) => void
  armMarkup: (kind: MarkupType) => void
  captureMarkup: (r: PdfRect) => void
  cancelMarkup: () => void
  setMarkupAuthor: (a: string) => void
  loadRecent: () => Promise<void>
  requestConfirm: (title: string, body: string) => Promise<boolean>
  // Modale PIN-Abfrage (Runde 53): resolve mit {pin,sigPin} oder null (Abbruch).
  pendingPin: PinRequest & { resolve: (r: PinResult | null) => void } | null
  requestPin: (req: PinRequest) => Promise<PinResult | null>
  resolvePin: (r: PinResult | null) => void
  resolveConfirm: (ok: boolean) => void
  requestClose: () => Promise<'save' | 'discard' | 'cancel'>
  resolveClose: (choice: 'save' | 'discard' | 'cancel') => void
  requestPassword: () => Promise<string | null>
  resolvePassword: (pw: string | null) => void
}

export type UiStore = UiState & UiActions

export const useUiStore = create<UiStore>()(
  immer((set, get) => ({
    activeTab: 'thumbnails',
    zoom: 1,
    zoomMode: 'fitPage', // R60 Nutzerwunsch: ganze Seite sichtbar ist die Standardeinstellung
    viewerMode: 'select',
    setViewerMode: (mode) => set((s) => { s.viewerMode = s.viewerMode === mode ? 'select' : mode }),
    viewRotation: 0,
    layoutMode: 'continuous',
    theme: 'light',
    invertPage: false,
    fullScreen: false,
    settingsOpen: false,
    tooltips: true,
    renderInfo: null,
    shortcutsOpen: false,
    undoOnDisk: true,
    pageFlash: false,
    selected: [],
    anchor: null,
    encryptDialog: false,
    pagesDialog: null,
    pagesDialogPreset: null,
    stampTool: null,
    graphicPlacement: null,
    sigField: null,
    sigInfo: null,
    imageSel: null,
    setImageSel: (v) => set((s) => { s.imageSel = v ? { ...v, rect: { ...v.rect } } : null }),
    placedGraphic: null,
    armGraphicPlacement: (p) => set((s) => { s.graphicPlacement = p; s.placedGraphic = null; s.imageSel = null }),
    armSigField: (arm) => set((s) => { if (arm) s.imageSel = null; s.sigInfo = null; s.sigField = arm ? (s.sigField ?? { page: 1, rect: { x: 4000, y: 4000, width: 220, height: 70 }, arm: true }) : null }),
    setSigField: (page, rect) => set((s) => { s.sigField = { page, rect, arm: false }; s.sigInfo = null }),
    openSigInfo: (page, rect, screen) => set((s) => { s.sigInfo = { page, rect: { ...rect }, screen } }),
    closeSigInfo: () => set((s) => { s.sigInfo = null }),
    moveSigField: (page, rect) => set((s) => { if (s.sigField) s.sigField = { page, rect, arm: false }; s.sigInfo = null }),
    clearSigField: () => set((s) => { s.sigField = null; s.sigInfo = null }),
    setPlacedGraphic: (page, rect) => set((s) => { s.placedGraphic = { page, rect: { ...rect } } }),
    clearGraphicPlacement: () => set((s) => { s.graphicPlacement = null; s.placedGraphic = null }),
    stampTarget: null,
    stampImage: null,
    highlightFormFields: true,
    selectedAnnotationId: null,
    repositionAnnotationId: null,
    markupTool: null,
    markupTarget: null,
    markupAuthor: '',
    recent: [],
    pendingPassword: null,
    pendingConfirm: null,
    pendingClose: null,

    setActiveTab: (t) => set((s) => { s.activeTab = t }),
    setZoom: (z, mode) =>
      set((s) => {
        s.zoom = clampZoom(z)
        s.zoomMode = mode ?? 'custom'
      }),
    zoomIn: () => set((s) => { s.zoom = stepZoom(s.zoom, 1); s.zoomMode = 'custom' }),
    zoomOut: () => set((s) => { s.zoom = stepZoom(s.zoom, -1); s.zoomMode = 'custom' }),
    rotateView: (dir) => set((s) => { s.viewRotation = stepViewRotation(s.viewRotation, dir) }),
    resetViewRotation: () => set((s) => { s.viewRotation = 0 }),
    setLayoutMode: (layoutMode) => set((s) => { s.layoutMode = layoutMode }),
    setTheme: (theme) => set((s) => { s.theme = theme }),
    toggleTheme: () => set((s) => { s.theme = s.theme === 'dark' ? 'light' : 'dark' }),
    toggleInvertPage: () => set((s) => { s.invertPage = !s.invertPage }),
    setFullScreen: (v) => set((s) => { s.fullScreen = v }),
    toggleFullScreen: () => {
      const d = typeof document !== 'undefined' ? document : undefined
      if (!d) return
      if (d.fullscreenElement) {
        void d.exitFullscreen?.().catch(() => undefined)
      } else {
        void d.documentElement.requestFullscreen?.().catch(() => undefined)
      }
      // Status wird per 'fullscreenchange'-Listener in AppShell gesetzt (echter Zustand).
    },
    openSettings: () => set((s) => { s.settingsOpen = true }),
    closeSettings: () => set((s) => { s.settingsOpen = false }),
    openShortcuts: () => set((s) => { s.shortcutsOpen = true }),
    closeShortcuts: () => set((s) => { s.shortcutsOpen = false }),
    setUndoOnDisk: (v) => set((s) => { s.undoOnDisk = v }),
    setTooltips: (v) => set((s) => { s.tooltips = v }),
    setRenderInfo: (info) => set((s) => { s.renderInfo = info }),
    loadAppSettings: async () => {
      const bridge = (globalThis as unknown as { pdfEditor?: { getAppSettings?: () => Promise<unknown> } }).pdfEditor
      if (!bridge?.getAppSettings) return
      try {
        const snap = (await bridge.getAppSettings()) as {
          settings: { renderMode: 'auto' | 'gpu' | 'software'; tooltips: boolean; gpuFailures: number }
          plan: { effective: 'gpu' | 'software'; reason: string }
        }
        set((s) => {
          s.tooltips = snap.settings.tooltips
          s.renderInfo = {
            mode: snap.settings.renderMode,
            effective: snap.plan.effective,
            reason: snap.plan.reason,
            gpuFailures: snap.settings.gpuFailures
          }
        })
      } catch {
        /* Einstellungen sind Komfort — Fehler duerfen die App nicht blockieren */
      }
    },
    flashPage: () => {
      set((s) => { s.pageFlash = true })
      setTimeout(() => set((s) => { s.pageFlash = false }), 600)
    },
    selectPage: (page, mode, total) =>
      set((s) => {
        const next = applySelection({ selected: s.selected, anchor: s.anchor }, page, mode, total)
        s.selected = next.selected
        s.anchor = next.anchor
      }),
    selectAllPages: (total) =>
      set((s) => {
        s.selected = Array.from({ length: total }, (_, i) => i + 1)
        s.anchor = total
      }),
    clearSelection: () => set((s) => { s.selected = []; s.anchor = null }),
    openEncryptDialog: () => set((s) => { s.encryptDialog = true }),
    closeEncryptDialog: () => set((s) => { s.encryptDialog = false }),
    openPagesDialog: (kind, preset) => set((s) => { s.pagesDialog = kind; s.pagesDialogPreset = preset ?? null }),
    closePagesDialog: () => set((s) => { s.pagesDialog = null; s.pagesDialogPreset = null }),
    armStamp: (kind) => set((s) => { s.stampTool = kind; s.stampTarget = null; s.imageSel = null }),
    captureStamp: (r) =>
      set((s) => {
        if (!s.stampTool) return
        s.stampTarget = { ...r, kind: s.stampTool }
        s.stampTool = null
      }),
    cancelStamp: () => set((s) => { s.stampTool = null; s.stampTarget = null; s.stampImage = null }),
    setStampImage: (img) => set((s) => { s.stampImage = img }),
    setHighlightFormFields: (on) => set((s) => { s.highlightFormFields = on }),
    setSelectedAnnotationId: (id) => set((s) => { s.selectedAnnotationId = id }),
    armReposition: (id) => set((s) => { s.repositionAnnotationId = id; if (id !== null) s.imageSel = null }),
    armMarkup: (kind) => set((s) => { s.markupTool = kind; s.markupTarget = null; s.imageSel = null }),
    captureMarkup: (r) => set((s) => { if (!s.markupTool) return; s.markupTarget = { ...r, kind: s.markupTool }; s.markupTool = null }),
    cancelMarkup: () => set((s) => { s.markupTool = null; s.markupTarget = null }),
    setMarkupAuthor: (a) => set((s) => { s.markupAuthor = a }),
    loadRecent: async () => {
      const list = await window.pdfEditor.listRecent()
      set((s) => { s.recent = list })
    },
    pendingPin: null,
    requestPin: (req) =>
      new Promise<PinResult | null>((resolve) => {
        set((s) => { s.pendingPin = { ...req, resolve } })
      }),
    resolvePin: (r) => {
      const fn = get().pendingPin?.resolve
      set((s) => { s.pendingPin = null })
      fn?.(r)
    },
    requestConfirm: (title, body) =>
      new Promise<boolean>((resolve) => {
        set((s) => { s.pendingConfirm = { title, body, resolve } })
      }),
    resolveConfirm: (ok) => {
      const r = get().pendingConfirm?.resolve
      set((s) => { s.pendingConfirm = null })
      r?.(ok)
    },
    requestClose: () =>
      new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
        set((s) => { s.pendingClose = resolve })
      }),
    resolveClose: (choice) => {
      const r = get().pendingClose
      set((s) => { s.pendingClose = null })
      r?.(choice)
    },
    requestPassword: () =>
      new Promise<string | null>((resolve) => {
        set((s) => { s.pendingPassword = resolve })
      }),
    resolvePassword: (pw) => {
      const r = get().pendingPassword
      set((s) => { s.pendingPassword = null })
      r?.(pw)
    }
  }))
)
