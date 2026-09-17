import { api, ApiError } from '@/lib/apiClient'
import { streamChat } from '@/lib/aiClient'
import { t } from '@/i18n'
import { useAppStore, refreshDocumentState, notifyError, notifySuccess, type Command, type CommandType } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { clampPage } from '@/store/useUiStore'

// Die einzige Stelle, die Dokument-Mutationen ausloest. Spricht ausschliesslich den getypten
// HTTP-Client (Layering: nie Backend direkt). haelt den mutationLock, fuehrt die Command-Metadaten
// (Section 3, nur fuer UI/Log — nie fuer Ruecknahme) und stoesst nach Erfolg docVersion++ an,
// damit der pdfjs-Renderer die aktuelle Arbeitskopie neu laedt.

function newCommand(type: CommandType, label: string, payload: unknown, reversible: boolean): Command {
  const st = useAppStore.getState()
  const seq = st.commands.length + 1
  return { id: crypto.randomUUID(), seq, type, payload, label, snapshotId: `${seq}-${type}`, reversible }
}

async function mutate(type: CommandType, label: string, payload: unknown, run: () => Promise<unknown>, reversible = true, skipSignedGate = false): Promise<boolean> {
  const st = useAppStore.getState()
  // Section 2.8: signiertes Dokument -> jede Mutation entwertet bestehende Signaturen. Zwingende
  // Rueckfrage, bevor der Snapshot entsteht — ein Abbruch veraendert nichts.
  // skipSignedGate: das Entfernen der Signaturen IST die Gegenaktion und fragt nicht.
  if (st.signedDoc && !skipSignedGate) {
    const ok = await useUiStore.getState().requestConfirm(t('confirm.signedTitle'), t('confirm.signedBody'))
    if (!ok) return false
  }
  if (!st.beginMutation()) return false
  try {
    await run()
    useAppStore.getState().pushCommand(newCommand(type, label, payload, reversible))
    await refreshDocumentState()
    useAppStore.getState().bumpDocVersion()
    return true
  } catch (err) {
    notifyError(err)
    return false
  } finally {
    useAppStore.getState().endMutation()
  }
}

interface OpenResponse {
  pageCount: number
  readOnly: boolean
  encrypted: boolean
}

// Oeffnet eine Datei. Bei Passwort-Pflicht/Fehler bis zu drei Versuege ueber das Modal; danach Abbruch.
export async function openDocument(path: string): Promise<boolean> {
  const s = useAppStore.getState()
  let password: string | undefined
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const res = await api.post<OpenResponse>('/document/open', password ? { path, password } : { path })
      const st = useAppStore.getState()
      st.clearHistory()
      st.clearDocument()
      st.setPageCount(res.pageCount)
      await refreshDocumentState()
      st.bumpDocVersion()
      // Zuletzt geoeffnet (Section 4): nur Metadaten-Pfad persistieren, dann Liste neu laden.
      try {
        await window.pdfEditor?.addRecent?.(path)
        await useUiStore.getState().loadRecent()
      } catch {
        /* Recent ist nicht kritisch */
      }
      return true
    } catch (err) {
      const needPw = err instanceof ApiError && (err.code === 'password_required' || err.code === 'wrong_password')
      if (needPw && attempt < 3) {
        const pw = await useUiStore.getState().requestPassword()
        if (pw === null) return false
        password = pw
        continue
      }
      notifyError(err)
      return false
    }
  }
  void s
  return false
}

export type SaveMode = 'save' | 'as' | 'copy'

export async function saveDocument(mode: SaveMode = 'save'): Promise<boolean> {
  const bridge = window.pdfEditor
  let target: string | null = null
  if (mode !== 'save') {
    target = await bridge.savePdfDialog('document.pdf')
    if (target === null) return false
    // Ueberschreib-Warnung (Nutzerwunsch Runde 51): existiert die Zieldatei, ZWINGEND
    // bestaetigen lassen — das Original bleibt sonst unwiederbringlich ueberschrieben.
    try {
      const { exists } = await api.post<{ exists: boolean }>('/fs/exists', { path: target })
      if (exists) {
        const name = target.split('/').pop() ?? target
        const ok = await useUiStore.getState().requestConfirm(t('confirm.overwriteTitle'), t('confirm.overwriteBody', { name }))
        if (!ok) return false
      }
    } catch {
      /* Existenzpruefung best effort — Save-Pfad selbst haelt die Fehler ab */
    }
  }
  const rebind = mode !== 'copy'
  try {
    await api.post('/document/save', target ? { path: target, rebind } : {})
    await refreshDocumentState()
    notifySuccess(t(mode === 'copy' ? 'common.saveCopy' : 'common.save'))
    return true
  } catch (err) {
    // Fehlende Schreibrechte -> automatisch "Speichern unter" (Section 4A), einmal — nur beim normalen Speichern.
    if (mode === 'save' && err instanceof ApiError && err.code === 'write_denied') {
      const alt = await bridge.savePdfDialog('document.pdf')
      if (alt === null) return false
      try {
        await api.post('/document/save', { path: alt, rebind: true })
        await refreshDocumentState()
        notifySuccess(t('common.save'))
        return true
      } catch (err2) {
        notifyError(err2)
        return false
      }
    }
    notifyError(err)
    return false
  }
}

// Dokument schliessen. Bei ungespeicherten Aenderungen zwingend 3 Optionen (Section 4):
// Speichern / Verwerfen / Abbrechen — nie ein 2-Button-Dialog, der eine falsche Wahl erzwingt.
export async function closeDocument(): Promise<void> {
  const st = useAppStore.getState()
  if (st.dirty) {
    const choice = await useUiStore.getState().requestClose()
    if (choice === 'cancel') return
    if (choice === 'save') {
      const ok = await saveDocument('save')
      if (!ok) return
    }
  }
  try {
    await api.post('/document/close', {})
  } catch (err) {
    notifyError(err)
    return
  }
  const s = useAppStore.getState()
  s.clearDocument()
  s.bumpDocVersion()
  useUiStore.getState().clearSelection()
}

export async function rotatePage(page0: number, delta = 90): Promise<boolean> {
  const p1 = page0 + 1
  return mutate('ROTATE_PAGE', t('undo.rotate', { page: p1 }), { page: page0, delta }, () => api.post('/pages/rotate', { page: page0, delta }))
}

export async function deletePage(page0: number): Promise<boolean> {
  const p1 = page0 + 1
  const ok = await mutate('DELETE_PAGE', t('undo.delete', { page: p1 }), { page: page0 }, () => api.post('/pages/delete', { page: page0 }))
  if (ok) {
    const st = useAppStore.getState()
    st.setCurrentPage(clampPage(st.currentPage, Math.max(0, st.pageCount - 1)))
  }
  return ok
}

export async function reorderPages(order: number[]): Promise<boolean> {
  return mutate('REORDER_PAGES', t('undo.reorder'), { order }, () => api.post('/pages/reorder', { order }))
}

export async function mergePdf(path: string): Promise<boolean> {
  const ok = await mutate('MERGE_PDF', t('undo.merge'), { path }, () => api.post('/pages/merge', { path }))
  if (ok) await refreshDocumentState()
  return ok
}

export interface MetadataPatch {
  title: string
  author: string
  subject: string
  keywords: string
}

export async function setMetadata(patch: MetadataPatch): Promise<boolean> {
  const ok = await mutate('SET_METADATA', t('undo.metadata'), patch, () => api.post('/document/metadata', patch))
  if (ok) notifySuccess(t('metadata.saved'))
  return ok
}


// 5.4 Nr. 7 "KI-Vorschlag": Vorschlag ueber das vorhandene Chat-Gateway (kein Sonder-Backend).
// Das Modell antwortet mit strikt JSON; wir parieren das erste JSON-Objekt. Scheitert die Parse,
// kommt null und das Feld bleibt unveraendert — ein Vorschlag, nie eine automatische Aenderung.
export async function suggestMetadata(page: number): Promise<MetadataPatch | null> {
  const prompt =
    'Erzeuge Dokument-Metadaten fuer die aktuelle Seite. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt der Form ' +
    '{"title":"","author":"","subject":"","keywords":""} ohne Erklaertext und ohne Markdown-Zaune.'
  let text = ''
  const controller = new AbortController()
  try {
    await streamChat({ question: prompt, page }, controller.signal, (e) => {
      if (e.kind === 'token') text += e.text
      else if (e.kind === 'error') throw new Error(e.message)
    })
  } catch (err) {
    notifyError(err)
    return null
  }
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>
    return {
      title: String(o.title ?? ''),
      author: String(o.author ?? ''),
      subject: String(o.subject ?? ''),
      keywords: String(o.keywords ?? '')
    }
  } catch {
    return null
  }
}


// ===================================================================== Section 6: Auswahl
export async function rotateSelection(expr: string, delta: number): Promise<boolean> {
  return mutate('ROTATE_SELECTION', t('undo.rotateSelection'), { expr, delta }, () => api.post('/pages/rotate-selection', { expr, delta }))
}
export async function deleteSelection(expr: string): Promise<boolean> {
  return mutate('DELETE_SELECTION', t('undo.deleteSelection'), { expr }, () => api.post('/pages/delete-selection', { expr }))
}
export async function duplicateSelection(expr: string, position: string, page?: number): Promise<boolean> {
  return mutate('DUPLICATE_PAGES', t('undo.duplicate'), { expr, position, page }, () => api.post('/pages/duplicate', { expr, position, page }))
}
export interface InsertSource { kind: 'blank' | 'image' | 'pdf'; width?: number; height?: number; path?: string; expr?: string; password?: string; scale?: boolean }
export async function insertPages(position: string, page: number | undefined, source: InsertSource): Promise<boolean> {
  const ok = await mutate('INSERT_PAGES', t('undo.insert'), { position, page, source }, () => api.post('/pages/insert', { position, page, source }))
  if (ok) await refreshDocumentState()
  return ok
}
// Erzeugt neue Dateien, Quelle unveraendert -> kein Command.
export async function extractPages(expr: string, destDir: string, each: boolean, baseName?: string): Promise<string> {
  const res = await api.post<{ created: string[]; count: number }>('/pages/extract', { expr, destDir, each, baseName })
  notifySuccess(t('pages.extracted', { count: res.count }))
  return res.created[0] ?? ''
}
export async function splitDocument(cfg: Record<string, unknown>): Promise<number> {
  const res = await api.post<{ created: string[]; count: number }>('/pages/split', cfg)
  notifySuccess(t('pages.splitDone', { count: res.count }))
  return res.count
}

export interface RectPt { x: number; y: number; width: number; height: number }
// Bildstempel / "Bild zu Seite" vorbereiten: Datei waehlen -> Main liest Base64 -> Bewaffnen.
// Kein Reusable-Library-Eintrag (das waere ein Signatur-/Stempel-Bibliotheksobjekt, Section 9);
// hier wird nur ein Bild an eine Position gesetzt. Fehler haelten eine konkrete Toast-Meldung.
export async function armImageStamp(): Promise<boolean> {
  const path = await window.pdfEditor?.pickImage?.()
  if (!path) return false
  const b64 = await window.pdfEditor?.readImageAsBase64?.(path)
  if (!b64) {
    useAppStore.getState().addToast({ kind: 'error', message: t('stamp.image.readFailed') })
    return false
  }
  const name = path.split(/[\\/]/).pop() ?? path
  useUiStore.getState().setStampImage({ b64, name })
  useUiStore.getState().armStamp('image')
  return true
}

// ===================================================================== Section 7: Stempel/Zahlen
export async function stampImageSelection(expr: string, rect: RectPt, imageB64: string, opts: { opacity?: number; rotation?: number; overlay?: boolean; keepProportion?: boolean } = {}): Promise<boolean> {
  return mutate('STAMP_IMAGE', t('undo.stampImage'), { expr, rect }, () => api.post('/stamps/image', { expr, ...rect, image: imageB64, ...opts }))
}
export async function stampText(cfg: Record<string, unknown>): Promise<boolean> {
  return mutate('STAMP_TEXT', t('undo.stampText'), cfg, () => api.post('/stamps/text', cfg))
}
export async function applyWatermark(cfg: Record<string, unknown>): Promise<boolean> {
  return mutate('WATERMARK', t('undo.watermark'), cfg, () => api.post('/stamps/watermark', cfg))
}
export async function addPageNumbers(cfg: Record<string, unknown>): Promise<boolean> {
  return mutate('PAGE_NUMBERS', t('undo.pageNumbers'), cfg, () => api.post('/stamps/page-numbers', cfg))
}
export interface RedactRegion { page: number; x: number; y: number; width: number; height: number }
export async function previewRedaction(regions: RedactRegion[]): Promise<{ willRedact: { page: number; strings: string[] }[] }> {
  return api.post('/redaction/preview', { regions })
}
export async function applyRedaction(regions: RedactRegion[], images = 'pixels'): Promise<boolean> {
  // Irreversibel: leert den Undo-Stack (Section 10) -> nicht reversibel.
  const ok = await mutate('REDACT_REGIONS', t('undo.redact'), { count: regions.length }, () => api.post('/redaction/apply', { regions, images }), false)
  if (ok) notifySuccess(t('redaction.applied'))
  return ok
}

// ===================================================================== Section 10: Sicherheit
export async function sanitize(): Promise<boolean> {
  const res = await mutate('SANITIZE', t('undo.sanitize'), {}, () => api.post<{ removed: Record<string, number>; total: number }>('/security/sanitize', {}))
  return res
}
export async function scrubMetadata(): Promise<boolean> {
  return mutate('SCRUB_METADATA', t('undo.scrub'), {}, () => api.post('/document/scrub-metadata', {}))
}
export interface FormField { name: string; page: number; type: string; signed?: boolean | undefined; value: string | boolean; options: string[]; required: boolean; readOnly: boolean; multiline: boolean; fontSize: number; maxLen: number; rect: { x: number; y: number; width: number; height: number } }
export interface FormFieldsResult { hasAcroForm: boolean; hasXfa: boolean; count: number; fields: FormField[] }
// §11: AcroForm-Felder lesen; Fuellen/Zuruecksetzen sind Commands (Snapshot + §2.8).
export async function getFormFields(): Promise<FormFieldsResult> {
  return api.get<FormFieldsResult>('/document/form-fields')
}
export async function fillForm(name: string, value: string | boolean): Promise<boolean> {
  return mutate('FILL_FORM', t('undo.fillForm'), { name }, () => api.post('/document/fill-form', { name, value }))
}
export async function resetForm(names?: string[]): Promise<boolean> {
  return mutate('RESET_FORM', t('undo.resetForm'), { names: names ?? 'all' }, () => api.post('/document/reset-form', names ? { names } : {}))
}

export interface Annotation { id: string; page: number; type: string; author: string; date: string; text: string }
// §8: Annotationen fuer die Liste lesen; Entfernen ueber Bereich ist ein Command (Snapshot + §2.8).
export async function listAnnotations(): Promise<Annotation[]> {
  const res = await api.get<{ annotations: Annotation[] }>('/document/annotations')
  return res.annotations
}
export interface NewAnnotation { page0: number; type: string; x: number; y: number; width?: number; height?: number; text?: string; color?: string; opacity?: number; author?: string; fontsize?: number }
// §8: neue Annotation anlegen (Command ADD_ANNOTATION -> Snapshot + §2.8-Gate).
export async function addAnnotation(a: NewAnnotation): Promise<boolean> {
  return mutate('ADD_ANNOTATION', t('undo.addAnnotation'), { page: a.page0, type: a.type }, () => api.post('/document/add-annotations', {
    page: a.page0, type: a.type, x: a.x, y: a.y, width: a.width ?? 0, height: a.height ?? 0,
    text: a.text ?? '', color: a.color, opacity: a.opacity ?? 1, author: a.author ?? '', fontsize: a.fontsize ?? 12
  }))
}

export interface AnnotationDetail extends Annotation { color: string | null; opacity: number; rect: { x: number; y: number; width: number; height: number } }
export interface AnnotationEdit { text?: string; author?: string; color?: string; opacity?: number; rect?: { x: number; y: number; width: number; height: number } }
// §8.c: einzelne Annotation lesen/bearbeiten/loeschen (bewegen+resizen ueber absolut rect, PDF-User-Space unten-links).
export async function getAnnotation(id: string): Promise<AnnotationDetail> {
  return api.get<AnnotationDetail>(`/document/annotation?id=${encodeURIComponent(id)}`)
}
export async function editAnnotation(id: string, e: AnnotationEdit): Promise<boolean> {
  return mutate('EDIT_ANNOTATION', t('undo.editAnnotation'), { id }, () => api.post('/document/edit-annotations', { id, ...e }))
}
export async function deleteAnnotation(id: string): Promise<boolean> {
  return mutate('DELETE_ANNOTATION', t('undo.deleteAnnotation'), { id }, () => api.post('/document/delete-annotation', { id }))
}

export async function removeAnnotations(expr?: string): Promise<boolean> {
  return mutate('REMOVE_ANNOTATIONS', t('undo.removeAnnotations'), { expr: expr ?? 'all' }, () => api.post('/document/remove-annotations', { expr }))
}

export interface OutlineItem { level: number; title: string; page: number }
// §5: bestehende Gliederung lesen (read-only in V1).
export async function getOutline(): Promise<OutlineItem[]> {
  const res = await api.get<{ outline: OutlineItem[] }>('/document/outline')
  return res.outline
}

export interface EmbeddedImage { page: number; index: number; xref: number; width: number; height: number; bpc: number; colorspace: string }
// §7: Aufloesungen der eingebetteten Bilder VOR der Extraktion holen, damit der Nutzer die
// Qualitaet beurteilen kann. Read-only (DateiProduzent folgt separat).
export async function listEmbeddedImages(expr: string): Promise<EmbeddedImage[]> {
  const res = await api.get<{ images: EmbeddedImage[] }>(`/document/images?expr=${encodeURIComponent(expr)}`)
  return res.images
}
export async function extractEmbeddedImages(expr: string, destDir: string, baseName?: string): Promise<number> {
  const res = await api.post<{ created: unknown[]; count: number }>('/document/extract-images', { expr, destDir, baseName })
  return res.count
}

export async function flatten(categories: string[]): Promise<boolean> {
  return mutate('FLATTEN', t('undo.flatten'), { categories }, () => api.post('/document/flatten', { categories }))
}
export async function encryptDoc(userPw: string, ownerPw?: string, permissions?: Record<string, unknown>): Promise<boolean> {
  // Irreversibel -> nicht reversibel.
  return mutate('ENCRYPT', t('undo.encrypt'), { hasOwner: ownerPw != null }, () => api.post('/document/encrypt', { password: userPw, ownerPw, permissions }), false)
}
export async function decryptCopy(cfg: Record<string, unknown>): Promise<string> {
  const res = await api.post<{ path: string }>('/document/decrypt', cfg)
  notifySuccess(t('security.decrypted'))
  return res.path
}

// ===================================================================== Section 12: Export
export async function exportImages(expr: string, destDir: string, fmt: string, dpi: number, baseName?: string): Promise<number> {
  const res = await api.post<{ count: number }>('/export/images', { expr, destDir, fmt, dpi, baseName })
  notifySuccess(t('export.done', { count: res.count }))
  return res.count
}
export async function exportText(expr: string, destDir: string, fmt: string, baseName?: string): Promise<string> {
  const res = await api.post<{ path: string }>('/export/text', { expr, destDir, fmt, baseName })
  notifySuccess(t('export.done', { count: 1 }))
  return res.path
}
export async function imagesToPdf(paths: string[], destDir: string, pageSize: string, orientation: string): Promise<string> {
  const res = await api.post<{ path: string }>('/export/images-to-pdf', { paths, destDir, pageSize, orientation })
  return res.path
}
export interface CompressResult { path: string; beforeBytes: number; afterBytes: number; savedPercent: number; smaller: boolean }
export async function compressDoc(destDir: string, targetDpi: number, jpegQuality: number): Promise<CompressResult> {
  return api.post('/export/compress', { destDir, targetDpi, jpegQuality })
}
export interface LineariseResult { path: string; linearized: boolean; beforeBytes: number; afterBytes: number; savedPercent: number }
export async function lineariseDoc(destDir: string): Promise<LineariseResult> {
  return api.post('/export/linearise', { destDir })
}

// ===================================================================== Section 9: Signaturen/Zertifikate
export interface SignatureMeta { id: string; name: string; fileName: string | null; defaultSizePt: number; defaultOpacity: number; createdAt: string | null; mime: string | null; hasImage: boolean }
export interface TrustAnchor { id: string; subject: string; issuer: string; serial: string; isCa: boolean; notAfter: string }

export async function listTrustAnchors(): Promise<TrustAnchor[]> {
  return (await api.get<{ anchors: TrustAnchor[] }>('/trust/anchors')).anchors
}
export async function importTrustAnchor(certB64: string, filename?: string): Promise<TrustAnchor> {
  const res = await api.post<{ imported: boolean; id: string; subject: string; isCa: boolean }>('/trust/anchors', { cert: certB64, filename })
  return { id: res.id, subject: res.subject, issuer: '', serial: '', isCa: res.isCa, notAfter: '' }
}
export async function deleteTrustAnchor(id: string): Promise<void> {
  await api.del(`/trust/anchors/${encodeURIComponent(id)}`)
}

export async function listSignatures(): Promise<SignatureMeta[]> {
  return (await api.get<{ signatures: SignatureMeta[] }>('/signatures')).signatures
}
export async function importSignature(name: string, imageB64: string, ext: string, sizePt: number, opacity: number): Promise<string> {
  const res = await api.post<{ id: string }>('/signatures/import', { name, image: imageB64, ext, sizePt, opacity })
  return res.id
}
export async function importSignatureFile(name: string, path: string, sizePt: number, opacity: number): Promise<string> {
  const res = await api.post<{ id: string }>('/signatures/import-file', { name, path, sizePt, opacity })
  return res.id
}
export async function createTextSignature(name: string, text: string): Promise<string> {
  const res = await api.post<{ id: string }>('/signatures/text', { name, text })
  return res.id
}
export async function deleteSignature(id: string): Promise<void> {
  await api.del(`/signatures/${encodeURIComponent(id)}`)
}
// Signaturgrafik als base64 (fuer Signatur-Erscheinungsbild, Section 9).
export async function getSignatureImageB64(id: string): Promise<string> {
  const buf = await api.getBytes(`/signatures/${encodeURIComponent(id)}/image`)
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin)
}
export interface CertInfo { subject: string; issuer: string; expired: boolean; notYetValid: boolean; selfSigned: boolean; hasPrivateKey: boolean; canSignWith: boolean; warnings: string[] }
export async function getGraphicFileB64(path: string): Promise<{ name: string; mime: string; b64: string }> {
  return api.get<{ name: string; mime: string; b64: string }>(`/signature-graphic?path=${encodeURIComponent(path)}`)
}

export async function verifySmartcardPin(module: string, slot: number, pin: string, sigPin?: string | undefined): Promise<{ verified: boolean }> {
  return api.post('/pkcs11/verify-pin', { module, slot, pin, sigPin: sigPin ?? undefined })
}

export async function removeSignatures(): Promise<boolean> {
  return mutate('REMOVE_SIGNATURES' as CommandType, t('undo.removeSignatures'), {}, () => api.post('/document/remove-signatures', {}), true, true)
}

export async function describeCertificate(path: string, password: string): Promise<CertInfo> {
  return api.post('/certificates/describe', { path, password })
}
export interface SignRect { x: number; y: number; width: number; height: number }
// Signieren (Section 9, Quelle 1 PKCS#12). Irreversibel (Undo-Historie wird verworfen). Das
// Passwort wird NUR im Aufruf uebergeben und NICHT in Payload/Snapshot/Log geschrieben.
export interface SignText { subject?: string | undefined; reason?: string | undefined; name?: string | undefined; location?: string | undefined; invisible?: boolean; imageB64?: string | undefined }
export async function signDocument(p12Path: string, password: string, page: number, rect: SignRect, text?: SignText): Promise<boolean> {
  return mutate(
    'SIGN',
    t('undo.sign'),
    { p12Path, page },
    () => api.post('/document/sign', { p12Path, password, page, ...rect, reason: text?.reason, name: text?.name, location: text?.location, invisible: text?.invisible ?? false, image: text?.imageB64, signSubject: text?.subject }),
    false
  )
}

export interface DocSignature { field: string | null; intact: boolean; valid: boolean; trusted: boolean; modifiedAfterSigning: boolean; verdict: string; name?: string | null; reason?: string | null; location?: string | null; signTime?: string | null; trustChain?: string[]; trustNote?: string }
export async function listDocumentSignatures(): Promise<DocSignature[]> {
  return (await api.get<{ signatures: DocSignature[] }>('/document/signatures')).signatures
}


// ===================================================================== Section 4: Eigenschaften
export interface FontInfo { name: string | null; type: string | null; embedded: boolean }
export interface DocProperties {
  fileSizeBytes: number | null
  pageCount: number
  pdfVersion: string | null
  producer: string | null
  creator: string | null
  creationDate: string | null
  modDate: string | null
  currentPage: number | null
  pageWidth: number | null
  pageHeight: number | null
  pageRotation: number
  encrypted: boolean
  encryptionAlgorithm: string | null
  permissions: number | null
  pendingEncryption: boolean
  linearized: boolean | null
  tagged: boolean
  hasForms: boolean
  attachmentCount: number
  hasJavaScript: boolean
  fonts: FontInfo[]
}
export async function getDocumentProperties(page: number): Promise<DocProperties> {
  return api.post('/document/properties', { page })
}

// --- Bild-/Grafik-Objekte nachtraglich bearbeiten (Runde 51) ---
export interface ImageObjectInfo {
  page: number
  index: number
  xref: number
  rect: { x: number; y: number; width: number; height: number }
  rotation: number
  pixelWidth: number | null
  pixelHeight: number | null
}
export async function listImageObjects(expr: string): Promise<ImageObjectInfo[]> {
  const res = await api.get<{ objects: ImageObjectInfo[] }>(`/document/image-objects?expr=${encodeURIComponent(expr)}`)
  return res.objects
}
export async function updateImageObject(page: number, bbox: RectPt, rect: RectPt, rotateDelta = 0): Promise<{ rect: RectPt; rotation: number } | null> {
  let out: { rect: RectPt; rotation: number } | null = null
  const ok = await mutate('IMAGE_OBJECT', t('undo.imageObject'), { page, rect, rotateDelta }, async () => {
    out = await api.post<{ rect: RectPt; rotation: number }>('/images/object/update', { page, bbox, rect, rotateDelta })
  })
  return ok ? out : null
}
export async function deleteImageObject(page: number, bbox: RectPt): Promise<boolean> {
  return mutate('IMAGE_OBJECT', t('undo.imageObjectDelete'), { page }, () => api.post('/images/object/delete', { page, bbox }))
}

// --- Smartcard / PKCS#11 (Runde 52) ---
export interface Pkcs11Device { module: string; slot: number; label: string; manufacturer: string; model: string; pinHint?: string }
export interface Pkcs11Cert { id: string; label: string; subject?: string; notAfter?: string; algorithm?: string; hasKey: boolean; subjectFull?: string; issuerFull?: string; notBefore?: string; serial?: string; sha1?: string; keyBits?: number; der?: string }
export async function listPkcs11Devices(): Promise<{ devices: Pkcs11Device[]; modules: string[] }> {
  return api.get('/pkcs11/devices')
}
export async function listPkcs11Certificates(module: string, slot: number): Promise<Pkcs11Cert[]> {
  const res = await api.get<{ certificates: Pkcs11Cert[]; certDers?: Record<string, string> }>(`/pkcs11/certificates?module=${encodeURIComponent(module)}&slot=${slot}`)
  const ders = res.certDers ?? {}
  return res.certificates.map((c) => ({ ...c, ...(ders[c.id] !== undefined ? { der: ders[c.id] } : {}) }))
}
export async function signWithSmartcard(args: { module: string; slot: number; certId: string; pin: string; sigPin?: string | undefined; page: number; rect: SignRect; reason?: string | undefined; name?: string | undefined; location?: string | undefined; subject?: string | undefined; image?: string | undefined; invisible?: boolean; caCerts?: string[] | undefined }): Promise<boolean> {
  return mutate('SIGN', t('undo.sign'), { slot: args.slot, certId: args.certId, page: args.page },
    () => {
      const { rect, ...rest } = args
      // Backend-Schema ist FLACH (x/y/width/height) — verschachteltes rect ergab 0/0/0/0
      // und 'Signaturfeld muss positiv sein' (Nutzerbefund HTTP 500).
      return api.post('/document/sign-pkcs11', { ...rest, ...rect, invisible: rest.invisible ?? false, signSubject: rest.subject, caCerts: rest.caCerts })
    }, false)
}
