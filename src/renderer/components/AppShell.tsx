import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore, stepZoom, clampPage } from '@/store/useUiStore'
import { useAiStore } from '@/store/useAiStore'
import { useDebugStore } from '@/store/useDebugStore'
import type { PdfRect } from '@/lib/pdfCoords'
import { PlacementBar } from '@/components/PlacementBar'
import { ImageObjectEditor } from '@/components/ImageObjectEditor'
import { SigFieldOverlay } from '@/components/SigFieldOverlay'
import { listImageObjects } from '@/lib/documents'
import { imageDataUrl } from '@/lib/imageMime'
import { DebugPanel } from '@/components/DebugPanel'
import { UidOverlay } from '@/components/UidOverlay'
import { usePdfDocument } from '@/hooks/usePdfDocument'
import { usePageSize } from '@/hooks/usePageSize'
import { useAllPageSizes, useAllPageFlatSizes } from '@/hooks/useAllPageSizes'
import { fitScale } from '@/lib/pdfjs'
import { fitWidthScale, anchorScrollForZoom, pageTopScroll, pageLabelFor, innerBox, layoutDimsForView, navGeometryForColumn, navGeometryForFacing, groupIndexWithLargestShare, pageForGroup, type NavGeometry } from '@/lib/viewerLayout'
import { TopBar } from '@/components/TopBar'
import { Sidebar } from '@/components/Sidebar'
import { PageCanvas } from '@/components/PageCanvas'
import { PageColumn } from '@/components/PageColumn'
import { ViewerContextMenu, type CanvasMenuRequest } from '@/components/ViewerContextMenu'
import { allRows, isSideBySide } from '@/lib/layout'
import { FacingColumn } from '@/components/FacingColumn'
import { SettingsModal } from '@/components/SettingsModal'
import { PasswordModal } from '@/components/PasswordModal'
import { ConfirmModal } from '@/components/ConfirmModal'
import { PinModal } from '@/components/PinModal'
import { SignatureBadge } from '@/components/SignatureBadge'
import { SigFieldClickOverlay } from '@/components/SigFieldClickOverlay'
import { RecentFiles } from '@/components/RecentFiles'
import { CloseDialog } from '@/components/CloseDialog'
import { StampTextDialog } from '@/components/StampTextDialog'
import { StampImageDialog } from '@/components/StampImageDialog'
import { AddAnnotationDialog } from '@/components/AddAnnotationDialog'
import { EncryptDialog } from '@/components/EncryptDialog'
import { SearchPanel } from '@/components/SearchPanel'
import { getFormFields, fillForm, editAnnotation, type FormFieldsResult } from '@/lib/documents'
import { ShortcutReferenceModal } from '@/components/ShortcutReferenceModal'
import { openDocument } from '@/lib/documents'
import { matchShortcut } from '@/lib/shortcuts'
import { dispatchCommand, dispatchShortcut } from '@/lib/commands'

// Die UI-Shell: TopBar, Sidebar mit funf Tabs, Canvas-Hauptbereich. Haelt die pdfjs-Dokumenten-
// Instanz EINMAL (an PageCanvas + ThumbnailList durchgereicht, kein Doppel-Load) und rechnet den
// Fit-Zoom aus der gemessenen Containergroesse. Globale Shortcuts: Registry-Dispatch (§7.6).

export function AppShell(): JSX.Element {
  const { doc } = usePdfDocument()
  const docVersion = useAppStore((s) => s.docVersion)
  const currentPage = useAppStore((s) => s.currentPage)
  const pageCount = useAppStore((s) => s.pageCount)
  const { zoom, zoomMode, setZoom, viewRotation, invertPage, layoutMode, stampTool, captureStamp, cancelStamp, markupTool, captureMarkup, cancelMarkup, repositionAnnotationId, armReposition, viewerMode } = useUiStore()
  const graphicPlacement = useUiStore((s) => s.graphicPlacement)
  const sigFieldArmed = useUiStore((s) => s.sigField?.arm ?? false)
  // R70: Seite des sichtbaren, nicht bewaffneten Signaturfelds — steuert die Dreh-Huelle.
  const sigFieldPage = useUiStore((s) => (s.sigField && !s.sigField.arm ? s.sigField.page : 0))
  const placedGraphic = useUiStore((s) => s.placedGraphic)
  const setPlacedGraphic = useUiStore((s) => s.setPlacedGraphic)
  const armGraphicPlacement = useUiStore((s) => s.armGraphicPlacement)
  const imageSel = useUiStore((s) => s.imageSel)
  const setImageSel = useUiStore((s) => s.setImageSel)
  const readOnly = useAppStore((s) => s.readOnly)
  const signedDoc = useAppStore((s) => s.signedDoc)
  const highlightFormFields = useUiStore((s) => s.highlightFormFields)
  const activeTool = useAiStore((s) => s.activeTool)
  const setTool = useAiStore((s) => s.setTool)
  const setRegion = useAiStore((s) => s.setRegion)
  const mainRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // §6: angefordertes Canvas-Kontextmenü (Rechtsklick auf eine Seite).
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuRequest | null>(null)
  // §6 Tastatur: Context-Menü-Taste (oder Shift+F10) öffnet das Canvas-Menü für die aktuelle
  // Seite, wenn der Fokus im Blätterbereich liegt (Thumbnail-Fokus handled ThumbnailList selbst).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
      const el = document.activeElement as HTMLElement | null
      if (!el || !doc) return
      if (el.closest('[data-testid^="thumb-item-"]')) return
      const col = el.closest('[data-testid="page-column"]')
      if (!col) return
      const r = col.getBoundingClientRect()
      setCanvasMenu({ page: Math.min(Math.max(currentPage, 1), Math.max(pageCount, 1)), x: r.left + r.width / 2, y: r.top + 80 })
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, currentPage, pageCount])
  // §6: aktive Textauswahl auf einer Seite (für die Canvas-Menü-Auswahl-Aktionen oben).
  const [textSelection, setTextSelection] = useState<{ page: number; text: string; rect: PdfRect } | null>(null)
  const onPageSelection = useCallback((page: number, sel: { text: string; rect: PdfRect } | null) => {
    setTextSelection(sel ? { page, ...sel } : null)
  }, [])
  const backendStatus = useAppStore((s) => s.backendStatus)
  const initialConsumed = useRef(false)
  const [formResult, setFormResult] = useState<FormFieldsResult | null>(null)

  // §11: Formularfelder der Arbeitskopie laden (nur wenn AkroForm vorhanden).
  useEffect(() => {
    let cancelled = false
    if (!doc) { setFormResult(null); return }
    getFormFields()
      .then((r) => { if (!cancelled) setFormResult(r) })
      .catch(() => { if (!cancelled) setFormResult(null) })
    return () => { cancelled = true }
  }, [doc, docVersion])
  const formFieldsByPage = (pn: number) => (formResult && formResult.hasAcroForm && formResult.count > 0 ? formResult.fields.filter((f) => f.page === pn) : undefined)

  const pageSize = usePageSize(doc, currentPage, docVersion)
  const allDims = useAllPageSizes(doc, docVersion)

  // R71: ungedrehte (PDF-Raum-)Masse je Seite samt Seitenrotation. PDF-Overlays und
  // Formularfelder rechnen in User-Space; die Anzeige-Rechnung nutzt layoutDims.
  const flatDims = useAllPageFlatSizes(doc, docVersion)

  // R70: Bei Anzeige-Drehung 90/270 sind Breite und Hoehe der Seite vertauscht. Diese
  // LAYOUT-Masse steuern Fit-Rechnung, Spaltengeometrie und Scroll-Anker; die PDF-Raum-Mathe
  // (Signaturfeld-Platzierung, Bildobjekte, Formularfelder) rechnet weiter mit den ungedrehten
  // Massen aus allDims — sonst wandert ein Klick an die falsche PDF-Stelle.
  const layoutDims = useMemo(() => layoutDimsForView(allDims, viewRotation), [allDims, viewRotation])

  // §4: eigener Dokument-Seitenlabel (z. B. römisch für Vorspann) — einmal beim Öffnen lesen.
  const [pageLabels, setPageLabels] = useState<Array<string> | null>(null)
  useEffect(() => {
    if (!doc) { setPageLabels(null); return }
    let alive = true
    void doc.getPageLabels().then((l) => { if (alive) setPageLabels(l) }).catch(() => { if (alive) setPageLabels(null) })
    return () => { alive = false }
  }, [doc])
  const labelFor = useCallback((p: number): string => pageLabelFor(pageLabels ?? [], p), [pageLabels])

  // Effektiv-Skalierung: custom = Benutzerwert; Fit-Modi aus gemessenem Container + Seitenbasis.
  // §4: Fit-Width/Fit-Page nutzen die BREITESTE/höchste Seite (alle Maße gecacht), damit
  // mischgrosse Dokumente konsistent und randlos skalieren; schmalere Seiten bleiben kleiner.
  let scale = zoom
  const maxW = layoutDims.reduce((m, d) => Math.max(m, d.w), 0)
  const maxH = layoutDims.reduce((m, d) => Math.max(m, d.h), 0)
  // §7.4 Paritaet: in Doppelseiten-Moden stehen zwei Zellen nebeneinander — fit-* rechnet
  // gegen HALBE Breite, sonst erzwingt die breite Zeile einen horizontalen Scrollbalken
  // (E2E-Fund facingParity: scrollWidth > clientWidth).
  const fitW = layoutMode === 'facing' || layoutMode === 'facing-cover' ? box.w / 2 : box.w
  if (layoutDims.length && box.w > 0) {
    // §4: Fit-Modi werden NICHT an clampZoom-Grenzen gelegt — sonst erzeugt Fit-Width in
    // schmalen Fenstern einen horizontalen Scrollbalken (E2E-Fund 400px, dpr1/2).
    if (zoomMode === 'fitWidth') scale = fitWidthScale(layoutDims, fitW)
    else if (zoomMode === 'fitPage' && box.h > 0 && maxW > 0 && maxH > 0) scale = Math.min(fitW / maxW, box.h / maxH)
  } else if (pageSize && box.w > 0) {
    if (zoomMode === 'fitWidth') scale = box.w / pageSize.width
    else if (zoomMode === 'fitPage' && box.h > 0) scale = fitScale(pageSize.width, pageSize.height, box.w, box.h)
  }

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    // initiale Messung wie contentRect: Client-Box minus Innenabstand, sonst ist der erste Frame
    // zu breit und Fit-Width erzeugt einen Horizontal-Scrollbar (§4).
    const cs = window.getComputedStyle(el)
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
    setBox(innerBox(el.clientWidth, el.clientHeight, padX, padY))
    return () => ro.disconnect()
  }, [])

  // Ctrl + Mausrad: kontinuierlicher Zoom (Section 4A, Grenze 10 %–800 % in stepZoom/clampZoom).
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom(stepZoom(useUiStore.getState().zoom, e.deltaY < 0 ? 1 : -1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setZoom])

  // §4 Spalten-Geometrie (center-unabhängig: Offsets/Höhen sind fix), genutzt für Scroll-Spy,
  // Seitenzahl-Sprung und Anker-Zoom. Das Render-Fenster berechnet PageColumn selbst.
  const GAP_PX = 20
  const showColumn = (layoutMode === 'continuous' || layoutMode === 'single') && layoutDims.length > 0
  // R73: Navigations-Geometrie jetzt fuer BEIDE Modi. Vorher gab es sie nur fuer Einspalten-Modi,
  // deshalb blieb in den Doppelseiten-Modi die Fokusseite auf Seite 1 stehen und alle weiteren
  // Seiten hingen als Platzhalter ("…") fest — der gemeldete Bug.
  const buildNav = useCallback(
    (s: number): NavGeometry | null => {
      if (layoutDims.length === 0) return null
      if (showColumn) return navGeometryForColumn(layoutDims, s, GAP_PX)
      if (isSideBySide(layoutMode)) return navGeometryForFacing(allRows(layoutMode, pageCount), layoutDims, s, GAP_PX)
      return null
    },
    [layoutDims, layoutMode, pageCount, showColumn]
  )
  const navGeom = useMemo(() => buildNav(scale), [buildNav, scale])

  const spyPageRef = useRef(0) // zuletzt Scroll-Spy-getriebene Seite -> verhindert Rück-Sprung
  const navLockUntil = useRef(0) // Fenster, in dem der Spy programmatisches Scrollen ignoriert

  // §4 Aktuelle-Seite = Seite mit dem größten Anteil am Viewport.
  useEffect(() => {
    if (!navGeom) return
    const el = mainRef.current
    if (!el) return
    const PAD = 24 // p-6 des Scrollcontainers über der Spalte
    const tops = navGeom.groupOffsets.map((o) => PAD + o)
    const bottoms = navGeom.groupHeights.map((h, i) => PAD + (navGeom.groupOffsets[i] ?? 0) + h)
    const onScroll = (): void => {
      if (Date.now() < navLockUntil.current) return
      const gi = groupIndexWithLargestShare(el.scrollTop, el.scrollTop + el.clientHeight, tops, bottoms)
      if (gi < 0) return
      const st = useAppStore.getState()
      const pg = pageForGroup(navGeom.groups, gi, st.currentPage)
      if (pg !== st.currentPage) {
        spyPageRef.current = pg
        st.setCurrentPage(pg)
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [navGeom])

  // §4 Seitenzahl eintippen -> Oberkante der Seite direkt unter das obere Padding (kein beliebiger
  // Versatz). Ignoriert spy-getriebene Änderungen, sonst würde jede Spy-Aktualisierung zurückspringen.
  useEffect(() => {
    if (!navGeom) return
    const el = mainRef.current
    if (!el) return
    if (spyPageRef.current === currentPage) {
      spyPageRef.current = 0
      return
    }
    const target = pageTopScroll(navGeom.offsetsByPage, currentPage)
    if (Math.abs(el.scrollTop - target) > 2) {
      navLockUntil.current = Date.now() + 200
      el.scrollTop = target
    }
  }, [currentPage, navGeom])

  // §4 Zoom behält den Viewport-Mittenpunkt (kein Reset nach oben).
  const prevScaleRef = useRef(scale)
  useEffect(() => {
    const prev = prevScaleRef.current
    prevScaleRef.current = scale
    if (!navGeom || prev === scale) return
    const el = mainRef.current
    if (!el) return
    const prevNav = buildNav(prev)
    if (!prevNav) return
    const next = anchorScrollForZoom({
      offsetsOld: prevNav.groupOffsets,
      heightsOld: prevNav.groupHeights,
      offsetsNew: navGeom.groupOffsets,
      heightsNew: navGeom.groupHeights,
      scrollTop: el.scrollTop,
      viewHeight: el.clientHeight
    })
    if (Math.abs(el.scrollTop - next) > 1) {
      navLockUntil.current = Date.now() + 200
      spyPageRef.current = useAppStore.getState().currentPage
      el.scrollTop = next
    }
  }, [scale, navGeom, buildNav])

  // Globale Shortcuts (§7.6): SHORTCUTS trifft die Taste, die COMMAND-REGISTRY besitzt die Aktion.
  // Keine lokale Aktions-Tabelle mehr — Tasten, Menü und Kontextmenüs teilen genau eine Definition.
  useEffect(() => {
    useDebugStore.getState().init()
    const onKey = (e: KeyboardEvent): void => {
      const id = matchShortcut(e)
      if (!id) return
      e.preventDefault()
      dispatchShortcut(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // §6-Menü-Bar: Main sendet nur Befehls-ids; Gate + Ausführung passieren HIER über die Registry.
  useEffect(() => {
    const off = window.pdfEditor.onMenuCommand?.(dispatchCommand)
    return () => off?.()
  }, [])

  // Einmalig eine beim Start per argv/.desktop (%f) uebergebene Datei oeffnen, sobald das
  // Backend bereit ist (openDocument braucht initialisierten Auth-Client).
  useEffect(() => {
    if (backendStatus !== 'ready' || initialConsumed.current) return
    initialConsumed.current = true
    void window.pdfEditor.getInitialFile().then((p) => {
      if (p) void openDocument(p)
    })
  }, [backendStatus])

  // Dark Mode: 'dark'-Klasse am <html>; die Chrome-Flaechen nutzen dark:-Varianten (Section 5).
  const theme = useUiStore((s) => s.theme)
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    return () => root.classList.remove('dark')
  }, [theme])

  // Vollbild: Status aus echtem document.fullscreenElement spiegeln; Pfeiltasten blaettern,
  // Esc verlaesst (nativ). Nur im Vollbild greift die Pfeil-Navigation (Section 5).
  const setFullScreen = useUiStore((s) => s.setFullScreen)
  useEffect(() => {
    const onChange = (): void => setFullScreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    const onKey = (e: KeyboardEvent): void => {
      if (!useUiStore.getState().fullScreen) return
      const st = useAppStore.getState()
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault(); st.setCurrentPage(clampPage(st.currentPage + 1, st.pageCount))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault(); st.setCurrentPage(clampPage(st.currentPage - 1, st.pageCount))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('fullscreenchange', onChange); window.removeEventListener('keydown', onKey) }
  }, [setFullScreen])

  // Datei-Drag&Drop (Nutzerwunsch): Grafik fallen lassen -> Vorschau + freie Platzierung;
  // PDF fallen lassen -> oeffnen. Der Browser-Navigation wird der Weg abgeschnitten.
  useEffect(() => {
    const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tif?f|svg)$/i
    const onOver = (e: DragEvent): void => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const onDrop = (e: DragEvent): void => {
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      e.preventDefault()
      const path = window.pdfEditor.pathForFile?.(file) ?? ''
      if (!path) return
      if (/\.pdf$/i.test(path)) { void openDocument(path); return }
      if (IMAGE_EXT.test(path)) {
        void (async () => {
          const b64 = await window.pdfEditor.readImageAsBase64?.(path)
          if (!b64) { useAppStore.getState().addToast({ kind: 'error', message: 'Bild konnte nicht gelesen werden' }); return }
          armGraphicPlacement({ mode: 'stamp', name: path.split('/').pop() ?? 'Bild', imageB64: b64, dataUrl: imageDataUrl(b64, path) })
        })()
      }
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('dragover', onOver); window.removeEventListener('drop', onDrop) }
  }, [armGraphicPlacement])

  const pageHOf = (p: number): number => flatDims[p - 1]?.h ?? 0 // PDF-Raum (ungedreht)
  const handlePdfClick = (page: number, gx: number, gy: number, screen: { x: number; y: number }): void => {
    // R64: Klick in ein Signaturfeld (echtes AcroForm-Feld) oeffnet das
    // Info-Popup — ohne Bewaffnung und ohne aktive Werkzeuge.
    if (sigFieldArmed || graphicPlacement || stampTool || markupTool || repositionAnnotationId) return
    const fields = formResult?.hasAcroForm ? formResult.fields.filter((f) => f.type === 'Signature' && f.page === page) : []
    const hit = fields.find((f) => gx >= f.rect.x - 2 && gx <= f.rect.x + f.rect.width + 2 && gy >= f.rect.y - 2 && gy <= f.rect.y + f.rect.height + 2)
    if (hit) useUiStore.getState().openSigInfo(page, hit.rect, screen)
    else if (useUiStore.getState().sigInfo) useUiStore.getState().closeSigInfo()
  }

  const handleDbl = async (page: number, gx: number, gy: number): Promise<void> => {
    if (graphicPlacement) return
    try {
      const objs = await listImageObjects(String(page))
      // Topmost-zuerst: Scans enthalten die ganze Seite als grosses Bild — der
      // Klick soll das KLEINSTE treffende Objekt (die eingebrachte Grafik)
      // selektieren, nicht den Seitenhintergrund. Toleranz 12pt (Nutzerdoppelklick
      // landet oft an der Kante der gezogenen Region, Bild wird proportional
      // kleiner gezeichnet).
      const TOL = 12
      let best: (typeof objs)[number] | null = null
      for (const o of objs) {
        const r = o.rect
        if (gx >= r.x - TOL && gx <= r.x + r.width + TOL && gy >= r.y - TOL && gy <= r.y + r.height + TOL) {
          const area = r.width * r.height
          if (!best || area < best.rect.width * best.rect.height) best = o
        }
      }
      if (best) {
        setImageSel({ page, rect: best.rect, rotation: best.rotation })
        return
      }
      // Nächste-Betreff-Fallback: Doppelklick knapp neben ein Objekt (Zentrum
      // innerhalb 80pt) wählt es trotzdem aus.
      let near: (typeof objs)[number] | null = null
      let nearD = 80
      for (const o of objs) {
        const cx = o.rect.x + o.rect.width / 2
        const cy = o.rect.y + o.rect.height / 2
        const d = Math.hypot(cx - gx, cy - gy)
        if (d < nearD) { nearD = d; near = o }
      }
      if (near) {
        setImageSel({ page, rect: near.rect, rotation: near.rotation })
        return
      }
      setImageSel(null)
    } catch { /* Dokumentwechsel — stumm */ }
  }

  // Doppelklick auf ein eingebettetes Bildobjekt waehlt es zum Nachbearbeiten aus
  // (Nutzerwunsch Runde 51); Esc hebt die Auswahl auf.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setImageSel(null) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [setImageSel])
  // R70: Die PDF-Raum-Overlays (platzierte Grafik, Bildobjekt-Auswahl, Signaturfeld) rechnen mit
  // der UNGEDREHTEN Seitenhoehe. Bei Anzeige-Drehung stecken sie deshalb in einer Huelle in
  // Originalgroesse, die um den Seitenmittelpunkt mitgedreht wird und damit exakt auf der
  // gedrehten Canvas liegt. Eine leere Huelle entsteht nie (sonst schluckt sie Seitenklicks).
  // R71: Gesamtdrehung der Anzeige = Seitenrotation (/Rotate) + Anzeige-Drehung. Die Huelle ist
  // in UNGEDREHTER Seitengroesse aufgebaut und wird um den Seitenmittelpunkt gedreht — damit
  // liegen PDF-Raum-Overlays exakt auf der gedrehten Canvas (auch bei gedrehter Seite selbst).
  const totalRotOf = (p: number): number => ((flatDims[p - 1]?.rotate ?? 0) + viewRotation + 360) % 360
  const overlayShell = (p: number, node: JSX.Element | null): JSX.Element | null => {
    if (node === null) return null
    const total = totalRotOf(p)
    if (total === 0) return node
    const d = flatDims[p - 1]
    if (!d) return null
    return (
      <div
        data-testid={`rot-overlay-${p}`}
        className="absolute left-1/2 top-1/2"
        style={{ width: d.w * scale, height: d.h * scale, transform: `translate(-50%, -50%) rotate(${total}deg)` }}
      >
        {node}
      </div>
    )
  }

  // Einzelne Seite als PageCanvas (identisch für Spalten-, Fallback- und Doppelseiten-Pfad).
  const renderPage = (p: number): JSX.Element => (
    <>
    <PageCanvas
      doc={doc}
      pageNumber={p}
      scale={scale}
      rotation={viewRotation}
      invert={invertPage}
      formFields={formFieldsByPage(p)}
      highlightFormFields={highlightFormFields}
      formReadOnly={readOnly || signedDoc}
      onFieldCommit={(n, v) => { void fillForm(n, v) }}
      onSelection={onPageSelection}
      activeTool={stampTool || markupTool || repositionAnnotationId || graphicPlacement || sigFieldArmed ? 'select-rect' : activeTool}
      onRect={(r) => {
        if (useUiStore.getState().sigField?.arm) {
          // R58 Nutzerablauf: EIN KLICK platziert das Standardfeld (220x70 pt)
          // zentriert auf der Klickstelle, an Seitengrenzen gequetscht. Grosse
          // gezogene Rechtecke behalten weiter ihre freie Groesse.
          if (r.width > 24 && r.height > 18) { useUiStore.getState().setSigField(p, r); return }
          const d = flatDims[p - 1]
          const w = Math.min(220, (d?.w ?? 612) - 16)
          const h = Math.min(70, (d?.h ?? 792) - 16)
          const cx = r.x + Math.max(r.width, 1) / 2
          const cy = r.y + Math.max(r.height, 1) / 2
          const x = Math.max(8, Math.min(cx - w / 2, (d?.w ?? 612) - w - 8))
          const y = Math.max(8, Math.min(cy - h / 2, (d?.h ?? 792) - h - 8))
          useUiStore.getState().setSigField(p, { x, y, width: w, height: h })
          return
        }
        if (graphicPlacement) setPlacedGraphic(p, r)
        else if (stampTool) captureStamp(r)
        else if (markupTool) captureMarkup(r)
        else if (repositionAnnotationId) { void editAnnotation(repositionAnnotationId, { rect: { x: r.x, y: r.y, width: r.width, height: r.height } }); armReposition(null) }
        else {
          setRegion(r)
          setTool('none')
        }
      }}
      onToolCancel={() => (stampTool ? cancelStamp() : markupTool ? cancelMarkup() : setTool('none'))}
      onRequestMenu={(p, x, y) => setCanvasMenu({ page: p, x, y })}
      onDblClickPdf={(pg, gx, gy) => { void handleDbl(pg, gx, gy) }}
      onPdfClick={(pg, gx, gy, sc) => { handlePdfClick(pg, gx, gy, sc) }}
    />
    {overlayShell(p, graphicPlacement && placedGraphic && placedGraphic.page === p ? (() => {
      const d = flatDims[p - 1]
      if (!d) return null
      const r = placedGraphic.rect
      return (
        <div
          data-testid={`place-overlay-${p}`}
          className="pointer-events-none absolute border-2 border-sky-500/80 bg-sky-100/30"
          style={{ left: r.x * scale, top: (d.h - r.y - r.height) * scale, width: r.width * scale, height: r.height * scale }}
        >
          <img src={graphicPlacement.dataUrl} alt="" className="h-full w-full object-contain opacity-80" />
        </div>
      )
    })() : null)}
    {overlayShell(p, imageSel && imageSel.page === p ? <ImageObjectEditor page={p} scale={scale} pageH={pageHOf(p)} rotation={totalRotOf(p)} /> : null)}
    {overlayShell(p, sigFieldPage === p ? <SigFieldOverlay page={p} scale={scale} pageH={pageHOf(p)} rotation={totalRotOf(p)} /> : null)}
    {false ? <span>render-marker {p}</span> : null}
    </>
  )

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 bg-white">
          <Sidebar doc={doc} />
        </div>
        <div ref={mainRef} className="relative min-w-0 flex-1 overflow-auto p-6"
          style={{ cursor: viewerMode === 'pan' ? 'grab' : viewerMode === 'text' ? 'text' : undefined, touchAction: viewerMode === 'pan' ? 'none' : undefined }}
          onPointerDown={(e) => {
            if (viewerMode !== 'pan') return
            const el = mainRef.current
            if (!el) return
            e.preventDefault()
            const sx = e.clientX; const sy = e.clientY; const sl = el.scrollLeft; const st = el.scrollTop
            el.setPointerCapture?.(e.pointerId)
            el.style.cursor = 'grabbing'
            const mv = (ev: PointerEvent): void => { el.scrollLeft = sl - (ev.clientX - sx); el.scrollTop = st - (ev.clientY - sy) }
            const up = (): void => {
              el.removeEventListener('pointermove', mv)
              el.removeEventListener('pointerup', up)
              el.removeEventListener('pointercancel', up)
              el.style.cursor = 'grab'
            }
            el.addEventListener('pointermove', mv)
            el.addEventListener('pointerup', up)
            el.addEventListener('pointercancel', up)
          }}>
          {doc ? (
            (layoutMode === 'continuous' || layoutMode === 'single') && layoutDims.length ? (
              <PageColumn
                dims={layoutDims}
                scale={scale}
                center={Math.min(currentPage, layoutDims.length) - 1}
                gap={20}
                current={currentPage}
                renderItem={(p) => renderPage(p)}
                labelFor={labelFor}
              />
            ) : isSideBySide(layoutMode) && layoutDims.length ? (
              // §7.4: Doppelseiten folgen DENSELBEN Regeln (real gemessene Slots, Labels,
              // gleich große Platzhalter, Rahmen auf der Seite) — nur die Anordnung ist paarweise.
              <FacingColumn
                dims={layoutDims}
                rows={allRows(layoutMode, pageCount)}
                scale={scale}
                gap={20}
                innerGap={12}
                current={currentPage}
                center={currentPage}
                renderItem={(p) => renderPage(p)}
                labelFor={labelFor}
              />
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-400">…</div>
            )
          ) : (
            <RecentFiles />
          )}
          <SearchPanel doc={doc} />
          {canvasMenu ? (
            <ViewerContextMenu menu={canvasMenu} textSelected={textSelection !== null} selection={textSelection} stamping={stampTool != null} onClose={() => setCanvasMenu(null)} />
          ) : null}
        </div>
      </div>
      <PlacementBar />
      <DebugPanel />
      {import.meta.env.DEV ? <UidOverlay /> : null}
      <SettingsModal />
      <PasswordModal />
      <ConfirmModal />
      <PinModal />
      <SigFieldClickOverlay />
      <SignatureBadge />
      <ShortcutReferenceModal />
      <CloseDialog />
      <StampTextDialog />
      <StampImageDialog />
      <AddAnnotationDialog />
      <EncryptDialog />
    </div>
  )
}
