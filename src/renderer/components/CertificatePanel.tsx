import { useEffect, useState } from 'react'
import { ShieldCheck, FileKey2, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { useT } from '@/i18n'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore, type SigFieldPlacement } from '@/store/useUiStore'
import { describeCertificate, signDocument, listTrustAnchors, importTrustAnchor, deleteTrustAnchor, type TrustAnchor, getDocumentProperties, verifySmartcardPin, listSignatures, getSignatureImageB64, getGraphicFileB64, listPkcs11Devices, listPkcs11Certificates, signWithSmartcard, type CertInfo, type SignatureMeta, type Pkcs11Device, type Pkcs11Cert } from '@/lib/documents'

// Zertifikats-Ueberblick + Signieren (Section 9, Quelle 1 PKCS#12). Vor dem Signieren werden
// Subjekt/Aussteller/Warnungen gezeigt; abgelaufene oder noch nicht gueltige Zertifikate koennen
// nicht verwendet werden. Das Passwort bleibt ausschliesslich in diesem Komponenten-State
// (Speicher) und wird nie persistiert. Quelle 2/3 (Smartcard/NSS) sind bewusst sichtbar degradiert (nur PKCS#12).

const input = 'w-full rounded border border-slate-300 px-2 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-600'
const btn = 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600'

function Section(props: { testid: string; title: string; open: boolean; onToggle: () => void; children: React.ReactNode }): JSX.Element {
  // Einklappbarer Bereich (Nutzerwish Runde 54): Seitenleiste bleibt bedienbar,
  // auch wenn beide Signierwege (PKCS#12 + Smartcard) gefüllt sind.
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700">
      <button type="button" data-testid={props.testid} aria-expanded={props.open} onClick={props.onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800">
        <ChevronRight size={14} className={props.open ? 'rotate-90 transition-transform' : 'transition-transform'} />
        {props.title}
      </button>
      {props.open ? <div className="space-y-2 px-2 pb-2">{props.children}</div> : null}
    </div>
  )
}

export function CertificatePanel(): JSX.Element {
  const t = useT()
  const docOpen = useAppStore((s) => s.docOpen)
  const currentPage = useAppStore((s) => s.currentPage)
  const addToast = useAppStore((s) => s.addToast)
  const [path, setPath] = useState('')
  const [password, setPassword] = useState('')
  const [info, setInfo] = useState<CertInfo | null>(null)
  const [reason, setReason] = useState('')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [invisible, setInvisible] = useState(false)
  const [lib, setLib] = useState<SignatureMeta[]>([])
  const [graphicId, setGraphicId] = useState('')
  const [graphicB64, setGraphicB64] = useState('')
  const [busy, setBusy] = useState(false)
  const sigField = useUiStore((s) => s.sigField)
  const armSigField = useUiStore((s) => s.armSigField)
  const clearSigField = useUiStore((s) => s.clearSigField)
  const [openP12, setOpenP12] = useState(false)
  const [openSc, setOpenSc] = useState(false)
  const [openTrust, setOpenTrust] = useState(false)
  const [trustAnchors, setTrustAnchors] = useState<TrustAnchor[]>([])
  const [trustBusy, setTrustBusy] = useState(false)
  // Smartcard-Zweig (Runde 52): Karten/Zertifikate oeffentlich lesbar; PINs nur im State.
  const [scDevices, setScDevices] = useState<Pkcs11Device[]>([])
  const [scDevice, setScDevice] = useState<string>('')
  const [scCerts, setScCerts] = useState<Pkcs11Cert[]>([])
  const [scCert, setScCert] = useState('')
  const [scBusy, setScBusy] = useState(false)
  // R60: eigene Grafik (z.B. Unterschrift als PNG/JPG) fuer das Signaturfeld —
  // auch im Smartcard-Abschnitt waehlbar (Nutzerwunsch).
  const [scGraphic, setScGraphic] = useState<{ name: string; b64: string } | null>(null)
  // R63: letzte Grafik-Pref aus dem App-Ordner laden (persistiert bis zum Entfernen).
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const pref = await window.pdfEditor.getSignatureGraphicPref?.()
        if (pref && live) {
          const g = await getGraphicFileB64(pref.path)
          if (live) setScGraphic({ name: pref.name, b64: g.b64 })
        }
      } catch { /* Pref optional */ }
    })()
    return () => { live = false }
  }, [])
  // R60: Voll-Anzeige der Kartenzertifikatsdaten nach dem Lesen (Popup).
  const [scDetail, setScDetail] = useState<Pkcs11Cert | null>(null)

  useEffect(() => {
    if (!docOpen) { setLib([]); return }
    let live = true
    void listSignatures().then((r) => { if (live) setLib(r.filter((x) => x.hasImage)) }).catch(() => { if (live) setLib([]) })
    return () => { live = false }
  }, [docOpen])

  const onScGraphicFile = async (): Promise<void> => {
    const p = await window.pdfEditor?.pickImage?.()
    if (!p) return
    try {
      const g = await getGraphicFileB64(p)
      setScGraphic({ name: g.name, b64: g.b64 })
      await window.pdfEditor.setSignatureGraphicPref?.({ path: p, name: g.name })
    } catch (e) {
      addToast({ kind: 'error', message: t('certs.sc.graphicError') + ': ' + String((e as Error)?.message ?? e).slice(0, 120) })
    }
  }

  const onGraphic = async (id: string): Promise<void> => {
    setGraphicId(id)
    if (!id) { setGraphicB64(''); return }
    try { setGraphicB64(await getSignatureImageB64(id)) } catch { setGraphicB64('') }
  }

  const refreshTrust = async (): Promise<void> => {
    try { setTrustAnchors(await listTrustAnchors()) } catch { setTrustAnchors([]) }
  }
  useEffect(() => { if (openTrust) void refreshTrust() }, [openTrust])

  const onTrustFile = async (file: File | null): Promise<void> => {
    if (!file) return
    setTrustBusy(true)
    try {
      const buf = await file.arrayBuffer()
      let b64 = ''
      const bytes = new Uint8Array(buf)
      let chunk = ''
      for (let i = 0; i < bytes.length; i += 0x8000) chunk += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      b64 = btoa(chunk)
      await importTrustAnchor(b64, file.name)
      addToast({ kind: 'success', message: t('certs.trust.imported') })
      await refreshTrust()
    } catch (e) {
      addToast({ kind: 'error', message: t('certs.trust.importError') + ': ' + String((e as Error)?.message ?? e).slice(0, 160) })
    } finally {
      setTrustBusy(false)
      const el = document.getElementById('cert-trust-input') as HTMLInputElement | null
      if (el) el.value = ''
    }
  }

  const onTrustDelete = async (id: string): Promise<void> => {
    try { await deleteTrustAnchor(id); await refreshTrust() } catch (e) {
      addToast({ kind: 'error', message: String((e as Error)?.message ?? e).slice(0, 140) })
    }
  }

  const loadSmartcards = async (): Promise<void> => {
    setScBusy(true)
    try {
      const { devices } = await listPkcs11Devices()
      // R60: Signier-Slots (PIN2) stehen vorn — die Signaturschluessel-PIN ist PIN2,
      // nicht PIN1. Auswahl und Zertifikatsliste zeigen den PIN-Hinweis der Karte.
      const ordered = [...devices].sort((a, b) => (b.pinHint === '(PIN2)' ? 1 : 0) - (a.pinHint === '(PIN2)' ? 1 : 0) || a.slot - b.slot)
      setScDevices(ordered)
      setScDevice(ordered.length ? `${ordered[0]!.module}#${ordered[0]!.slot}` : '')
      const certs = ordered.length ? await listPkcs11Certificates(ordered[0]!.module, ordered[0]!.slot) : []
      setScCerts(certs)
      setScCert(certs.length === 1 ? certs[0]!.id : '')
    } catch {
      setScDevices([]); setScCerts([])
    } finally { setScBusy(false) }
  }
  const onScDevice = async (v: string): Promise<void> => {
    setScDevice(v); setScCert('')
    const [module, slotS] = v.split('#')
    if (module === undefined || slotS === undefined) { setScCerts([]); return }
    try {
      const certs = await listPkcs11Certificates(module, Number(slotS))
      setScCerts(certs)
      if (certs.length === 1) setScCert(certs[0]!.id)
    } catch { setScCerts([]) }
  }
  // 'Max Mustermann' aus CN='Max Mustermann;372...' oder 'CN=Max Mustermann,O=...'
  const cnToName = (subject?: string | undefined): string => {
    if (!subject) return ''
    const cn = subject.includes('CN=') ? subject.split('CN=')[1]!.split(',')[0]! : subject
    const part = cn.split(';')[0]!.trim()
    return part.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 2).join(' ')
  }

  // R58 Nutzerablauf: Zuerst das Feld per KLICK auf der Seite platzieren, ERST
  // danach kommt die PIN — und sie wird vor der Signatur geprueft (gruener Haken).
  const ensurePlacedField = async (): Promise<SigFieldPlacement | null> => {
    const now = useUiStore.getState().sigField
    if (now && !now.arm) return now
    useUiStore.getState().armSigField(true)
    addToast({ kind: 'info', message: t('certs.placeFirst') })
    return new Promise((resolve) => {
      const unsub = useUiStore.subscribe((st) => {
        if (st.sigField && !st.sigField.arm) { unsub(); resolve(st.sigField) }
        else if (!st.sigField) { unsub(); resolve(null) } // Bewaffnung abgebrochen
      })
    })
  }

  const onScSign = async (): Promise<void> => {
    const [module, slotS] = scDevice.split('#')
    if (module === undefined || slotS === undefined || !scCert) return
    const placed = await ensurePlacedField()
    if (!placed) return
    // PIN-Abfrage als modales Dialogfenster mit Vor-Verifikation (Runde 58).
    const res = await useUiStore.getState().requestPin({
      title: t('certs.sc.pinDialog.title'),
      body: t('certs.sc.pinDialog.body'),
      // Eine PIN genugt (Nutzerbefund R59): die Signierschluessel-Slot-PIN (PIN2)
      // wird vom Signiervorgang selbst verwendet; kein zweites Feld.
      needSigPin: false,
      verify: async (pin, sigPin) => {
        try { await verifySmartcardPin(module, Number(slotS), pin, sigPin); return { ok: true } }
        catch (e) { return { ok: false, message: String((e as Error)?.message ?? e).slice(0, 180) } }
      },
    })
    if (!res) return
    setScBusy(true)
    try {
      const sel = scCerts.find((c) => c.id === scCert)
      const ok = await signWithSmartcard({
        module, slot: Number(slotS), certId: scCert, pin: res.pin,
        sigPin: res.sigPin, page: placed.page - 1,
        rect: placed.rect,
        image: scGraphic?.b64 ?? (graphicId ? graphicB64 || undefined : undefined),
        // R60: Name aus dem Karten-CN (Name+Vorname), damit das Feld den vollstaendigen
        // Namen zeigt — 'BARTH' allein war zu wenig.
        reason: reason || undefined, name: name.trim() || cnToName(sel?.subject) || undefined, location: location || undefined,
        subject: sel?.subject,
        // R66: Aussteller-Zertifikate der Karte mitgeben — sie werden in die
        // Signatur eingebettet, damit Pruefer (Adobe/windows-eigene Store) die
        // Kette bis zur Wurzel aufbauen koennen: 'CA trusted' auch hier.
        caCerts: scCerts.map((c) => c.der).filter((d): d is string => Boolean(d)),
      })
      if (ok) useUiStore.getState().clearSigField()
    } finally { setScBusy(false) }
  }

  const onPick = async (): Promise<void> => {
    const p = await window.pdfEditor.pickCertDialog()
    if (p) {
      setPath(p)
      setInfo(null)
    }
  }

  const onDescribe = async (): Promise<void> => {
    if (!path) return
    setBusy(true)
    try {
      const i = await describeCertificate(path, password)
      setInfo(i)
      // R65: Der Zert-CN ist der sichtbare Signaturname — vor dem Signieren
      // vorbelegen, damit er im Feld erscheint (Nutzer: Name soll im Feld stehen).
      if (!name.trim()) setName(cnToName(i.subject))
    } catch {
      setInfo(null)
      addToast({ kind: 'error', message: t('certs.error') })
    } finally {
      setBusy(false)
    }
  }

  const blockReason = !info
    ? t('certs.describe')
    : info.expired || info.notYetValid
      ? t('certs.blocked')
      : !info.canSignWith
        ? t('certs.noPrivateKey')
        : !docOpen
          ? t('certs.needDoc')
          : null

  const onSign = async (): Promise<void> => {
    if (blockReason || !path) return
    setBusy(true)
    try {
      // R58: sichtbare Signatur verlangt erst die Feld-Platzierung per Klick.
      let placed = useUiStore.getState().sigField && !useUiStore.getState().sigField!.arm ? useUiStore.getState().sigField : null
      if (!placed && !invisible) {
        setBusy(false)
        placed = await ensurePlacedField()
        setBusy(true)
        if (!placed) return
      }
      if (placed) {
        const ok = await signDocument(path, password, placed.page - 1, placed.rect, { reason: reason || undefined, name: name || undefined, location: location || undefined, invisible, imageB64: graphicB64 || undefined, subject: info?.subject })
        if (ok) useUiStore.getState().clearSigField()
        return
      }
      const props = await getDocumentProperties(currentPage)
      const pw = props.pageWidth ?? 612
      const ph = props.pageHeight ?? 792
      const w = Math.min(200, Math.max(120, pw * 0.34))
      const h = Math.min(70, Math.max(40, ph * 0.1))
      const x = Math.max(18, pw - w - 18)
      const y = 24
      const ok = await signDocument(path, password, currentPage - 1, { x, y, width: w, height: h }, {
        reason: reason.trim() || undefined,
        name: name.trim() || cnToName(info?.subject) || undefined,
        location: location.trim() || undefined,
        invisible,
        imageB64: !invisible && graphicId ? graphicB64 || undefined : undefined
      })
      if (ok) addToast({ kind: 'success', message: t('certs.signBtn') })
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 p-2 text-sm">
      <Section testid="cert-sec-p12" title={t('certs.p12.title')} open={openP12} onToggle={() => setOpenP12((v) => !v)}>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} data-testid="cert-field-arm" onClick={() => armSigField(!(sigField?.arm ?? false))}>
          <ShieldCheck size={14} /> {sigField?.arm ? t('certs.field.armCancel') : t('certs.field.arm')}
        </button>
        {sigField && !sigField.arm ? <span className="text-xs text-emerald-700" data-testid="cert-field-info">{t('certs.field.placed', { page: sigField.page })}</span> : null}
        {sigField && !sigField.arm ? (
          // R59: eigenes Entfernen des geplatzten Feldes als BUTTON (der kleine X-Knopf
          // am Overlay war zu unauffaellig). Bewaffneter Zustand hat keinen — Abbruch
          // ueber 'Bewaffnung aufheben'.
          <button type="button" className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300" data-testid="cert-field-clear" onClick={() => clearSigField()}>
            {t('certs.field.remove')}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-slate-400">{t('certs.field.hint')}</p>
      <p className="text-xs text-slate-500">{t('certs.sourceHint')}</p>

      <div className="flex gap-2">
        <input className={input} readOnly value={path} placeholder={t('certs.choose')} data-testid="cert-path" />
        <button type="button" className={btn} data-testid="cert-choose" onClick={() => void onPick()}>
          <FileKey2 size={14} />
        </button>
      </div>
      <div>
        <input type="password" className={input} value={password} placeholder={t('certs.password')} data-testid="cert-pw" onChange={(e) => setPassword(e.target.value)} />
        <p className="mt-1 text-xs text-slate-500">{t('certs.pwHint')}</p>
      </div>
      <button type="button" className={btn} data-testid="cert-describe" disabled={!path || busy} onClick={() => void onDescribe()}>
        <ShieldCheck size={14} /> {t('certs.describe')}
      </button>

      {info && (
        <div className="space-y-1 rounded-md border border-slate-200 p-2 dark:border-slate-700">
          <div className="truncate" title={info.subject}><span className="text-slate-500">{t('certs.subject')}:</span> {info.subject}</div>
          <div className="truncate" title={info.issuer}><span className="text-slate-500">{t('certs.issuer')}:</span> {info.issuer}</div>
          <div>{info.hasPrivateKey ? t('certs.privateKey') : t('certs.noPrivateKey')}</div>
          <div className="mt-1 text-xs font-medium text-slate-500">{t('certs.warningsTitle')}</div>
          {info.warnings.length === 0 ? (
            <div className="text-emerald-700 dark:text-emerald-400">{t('certs.noWarnings')}</div>
          ) : (
            <ul className="list-disc space-y-0.5 pl-5 text-red-600">
              {info.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <input className={input} data-testid="cert-sign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('certs.signName')} />
        <input className={input} data-testid="cert-sign-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('certs.signReason')} />
        <input className={input} data-testid="cert-sign-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('certs.signLocation')} />
        {lib.length > 0 && (
          <select className={input} data-testid="cert-sign-graphic" value={graphicId} disabled={invisible} onChange={(e) => void onGraphic(e.target.value)}>
            <option value="">{t('certs.signGraphicNone')}</option>
            {lib.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" data-testid="cert-sign-invisible" checked={invisible} onChange={(e) => setInvisible(e.target.checked)} />
          {t('certs.signInvisible')}
        </label>
      </div>
      {blockReason ? <p className="text-xs text-amber-600">{blockReason}</p> : null}
      <p className="text-xs text-slate-500">{t('certs.signHint')}</p>
      <button type="button" className={btn + ' bg-sky-600 text-white hover:bg-sky-700'} data-testid="cert-sign" disabled={blockReason !== null || busy} onClick={() => void onSign()}>
        <ShieldCheck size={14} /> {t('certs.signBtn')}
      </button>
      </Section>

      <Section testid="cert-sec-sc" title={t('certs.sc.title')} open={openSc} onToggle={() => setOpenSc((v) => !v)}>
      <p className="text-xs text-slate-500">{t('certs.sc.hint')}</p>
      <button type="button" className={btn} data-testid="cert-sc-load" disabled={scBusy || !docOpen} onClick={() => void loadSmartcards()}>
        <FileKey2 size={14} /> {t('certs.sc.load')}
      </button>
      {/* R63: Grafik-Auswahl UNABHAENGIG von der Kartenanzeige — die Pref gilt fuer
          das Signaturfeld und soll sichtbar sein, auch vor/ohne Kartengeraet. */}
      <div className="flex items-center gap-2" data-testid="cert-sc-graphic-row">
        <button type="button" className={btn} data-testid="cert-sc-graphic-file" onClick={() => void onScGraphicFile()}>
          <ImageIcon size={14} /> {scGraphic ? scGraphic.name : t('certs.sc.graphicPick')}
        </button>
        {scGraphic ? (
          <button type="button" className="text-xs text-red-600 hover:underline" data-testid="cert-sc-graphic-clear" onClick={() => { setScGraphic(null); void window.pdfEditor.setSignatureGraphicPref?.(null) }}>{t('certs.graphicRemove')}</button>
        ) : null}
      </div>
      {scDevices.length > 0 ? (
        <div className="space-y-2">
          <select className={input} data-testid="cert-sc-device" value={scDevice} onChange={(e) => void onScDevice(e.target.value)}>
            {[...scDevices].sort((a, b) => (b.pinHint === '(PIN2)' ? 1 : 0) - (a.pinHint === '(PIN2)' ? 1 : 0) || a.slot - b.slot).map((d) => (<option key={`${d.module}#${d.slot}`} value={`${d.module}#${d.slot}`}>{d.label}{d.pinHint ? ` ${d.pinHint}` : ''} — {d.manufacturer} (Slot {d.slot})</option>))}
          </select>
          <div className="space-y-1">
            {scCerts.map((c) => (
              <label key={c.id} className="flex items-start gap-2 rounded border border-slate-200 px-2 py-1.5 text-xs dark:border-slate-700" data-testid={`cert-sc-cert-${c.id}`}>
                <input type="radio" name="sc-cert" data-testid={`cert-sc-pick-${c.id}`} className="mt-0.5" checked={scCert === c.id} onChange={() => setScCert(c.id)} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.label || c.id}</span>
                  <span className="block truncate text-slate-500">{c.subject ?? ''}{c.notAfter ? ` · ${c.notAfter.slice(0, 10)}` : ''}</span>
                </span>
                <button type="button" data-testid={`cert-sc-detail-${c.id}`} title={t('certs.sc.details')}
                  className="ml-auto shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setScDetail(c) }}>
                  {t('certs.sc.details')}
                </button>
              </label>
            ))}
            {scCerts.length === 0 ? <p className="text-xs text-slate-400">{t('certs.sc.empty')}</p> : null}
          </div>
          <button type="button" className={btn + ' bg-sky-600 text-white hover:bg-sky-700'} data-testid="cert-sc-sign" disabled={!scCert || scBusy} onClick={() => void onScSign()}>
            <ShieldCheck size={14} /> {t('certs.sc.sign')}
          </button>
          <p className="text-xs text-slate-500">{t('certs.sc.pinHint')}</p>
        </div>
      ) : null}
      </Section>
      <Section testid="cert-sec-trust" title={t('certs.trust.title')} open={openTrust} onToggle={() => setOpenTrust((v) => !v)}>
        <p className="text-xs text-slate-500">{t('certs.trust.hint')}</p>
        <label className={btn + ' cursor-pointer'} data-testid="cert-trust-import" htmlFor="cert-trust-input">
          <ShieldCheck size={14} /> {t('certs.trust.pick')}
        </label>
        <input id="cert-trust-input" type="file" accept=".pem,.der,.crt,.cer,.cer.pem,application/x-x509-ca-cert" className="hidden" data-testid="cert-trust-input" disabled={trustBusy}
          onChange={(e) => { void onTrustFile(e.target.files?.[0] ?? null) }} />
        {trustAnchors.length > 0 ? (
          <ul className="space-y-1">
            {trustAnchors.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700" data-testid={`cert-trust-row-${a.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.subject}</span>
                  <span className="block truncate text-slate-500">{a.notAfter ? a.notAfter.slice(0, 10) : ''}</span>
                </span>
                <button type="button" className="text-red-600 hover:underline" data-testid={`cert-trust-del-${a.id}`} onClick={() => void onTrustDelete(a.id)}>{t('certs.trust.remove')}</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400" data-testid="cert-trust-empty">{t('certs.trust.empty')}</p>
        )}
      </Section>
      {scDetail ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" data-testid="cert-sc-detail-modal" role="dialog" aria-modal="true" onClick={() => setScDetail(null)}>
          <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-4 text-sm shadow-xl dark:border-slate-600 dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">{t('certs.sc.detailsTitle')}</h3>
              <button type="button" data-testid="cert-sc-detail-close" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={() => setScDetail(null)} aria-label="Schließen">✕</button>
            </div>
            <dl className="space-y-1.5 text-xs">
              {([
                ['Bezeichnung', scDetail.label], ['Inhaber (CN)', scDetail.subject], ['Subjekt (voll)', scDetail.subjectFull],
                ['Aussteller', scDetail.issuerFull], ['Gültig ab', scDetail.notBefore], ['Gültig bis', scDetail.notAfter],
                ['Seriennummer', scDetail.serial], ['Signaturalgorithmus-OID', scDetail.algorithm],
                ['Schlüssel', scDetail.keyBits ? `${scDetail.keyBits} bit` : undefined], ['Fingerabdruck (SHA-1)', scDetail.sha1],
                ['Zugriffs-ID (CKA_ID)', scDetail.id], ['Privater Schlüssel vorhanden', scDetail.hasKey ? 'ja' : 'nein'],
              ] as const).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
                <div key={k} className="grid grid-cols-[132px_minmax(0,1fr)] gap-4">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="break-all font-mono">{String(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-slate-400">{t('certs.sc.detailsValidNote')}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
