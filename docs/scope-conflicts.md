# SCOPE CONFLICTS — Entscheidungen ausstehend (nicht stillschweigend gelöst)

Autorität: SYSTEM PROMPT PART 2 (Scope) + `system-prompt-pdf-editor-en.md` (Architektur).
Regel (Architektur §0): Bei Widerspruch/Unmachbarkeit **⚠️ CONFLICT** melden und auf
Entscheidung warten — nicht still in eine Richtung auflösen. Dieses Log hält die offenen
Punkte fest. Solange offen, werden diese Features **nicht** gebaut; konfliktfreie V1‑Features
haben Vorrang.

Stand der Beweisaufnahme: verifiziert gegen die gepinnte venv
(`backend/.venv`) und dieses Fedora‑System.

---

## C1 — PKCS#11‑Token‑Signieren (§9 Quelle 2) — NICHT mit gepinnter Stack baubar
**Beweis:** `python-pkcs11` ist in `requirements.txt` nicht enthalten und nicht importierbar.
`pyHanko` 0.37.0 stellt hier **kein** Signier‑Modul (`pyhanko.pkcs11` fehlt) bereit.
Gutachten: Die OS‑Seite existiert — `/usr/lib64/opensc-pkcs11.so` und
`/usr/lib64/pkcs11/{opensc,gnome-keyring,p11-kit,...}` sind vorhanden. Es fehlt nur die
Python‑Brücke.

**§9 behauptet, pyHanko unterstütze dies „direkt" — mit der gepinnten Version hier nicht der Fall.**

Optionen:
- (A) `python-pkcs11` als neue gepinnte Abhängigkeit aufnehmen (Abweichung von „keine neuen
  Deps"); ermöglicht echtes Token‑Signieren.
- (B) V1 auf PKCS#12 (+ ggf. NSS) beschränken; PKCS#11 als „Smartcard in diesem Build nicht
  unterstützt" sichtbar degradieren (Sidecar‑Muster wie Docling).

**Status: ENTSCHIEDEN (B, 2026‑09‑14, Nutzer‑Delegation an KI).** Kein Token vorhanden und `python-pkcs11` ist nicht gepinnt → kein testbares Token‑Signieren ohne ungepinnte Abhängigkeit. Sichtbar degradiert: `certs.sourceHint` weist im Signier‑Panel explizit aus, dass nur PKCS#12 unterstützt wird (Sidecar‑Muster wie Docling). Kein Feature vorgetäuscht.

---

## C2 — Signieren aus NSS‑Datenbank (§9 Quelle 3) — nicht von pyHanko unterstützt
**Beweis:** `~/.pki/nssdb` existiert (fast leer). `pyHanko` hat **keinen** Signer, der die
NSS‑DB zum Signieren liest (NSS wird nur für Trust‑Prüfung/Verifikation genutzt). Signieren aus
NSS braucht eine zusätzliche Brücke (z. B. NSS→PKCS#12), die nicht gepinnt ist.

Optionen:
- (A) Brücke ergänzen.
- (B) NSS in V1 nur **anzeigen** (installierte Zertifikate auflisten) und **nur aus PKCS#12
  signieren**; NSS‑Signieren als V1.1 markieren.

**Status: ENTSCHIEDEN (B, 2026‑09‑14, Nutzer‑Delegation an KI).** Signieren nur aus PKCS#12; NSS/Smartcard im Signier‑Panel sichtbar als nicht unterstützt gekennzeichnet (`certs.sourceHint`). Eine NSS→PKCS#12‑Brücke ist nicht gepinnt und wird nicht eingeführt.

---

## C3 — Lineares PDF / „Fast Web View" (§12 [V1]) — nicht mit gepinntem pikepdf
**Beweis:** `pikepdf` 10.13.0 hat **kein** `linearize()`/`make_linearized()` mehr (nur
`is_linearized()` und `check_linearization()` — also **erkennen**, nicht **erzeugen**). `qpdf`
CLI ist nicht im PATH. §12 nennt Linearise als [V1] und sagt, pikepdf sei „already in the stack
for it" — das trifft auf die gepinnte Version nicht mehr zu.

Optionen:
- (A) externes `qpdf` als optionales Sidecar‑Werkzeug erkennen/nutzen (Docling‑Muster).
- (B) Lineares‑Erzeugen von V1 auf V1.1/OUT verschieben; „linearisiert?" anzeigen bleibt.

**Status: GELÖST (2026‑09‑14) — Prämisse war falsch.** `pikepdf.save(linearize=True)` erzeugt sehr wohl ein lineares PDF über die gebündelte libqpdf (verifiziert: Ausgabedatei hat `is_linearized == True`). Kein externes qpdf nötig, keine neue Abhängigkeit. Umgesetzt: `export_ops.linearise` + `/export/linearise` + `lineariseDoc` + ExportDialog‑Aktion. §2.7: Route lehnt verschlüsselte Dokumente VOR dem Lauf ab (Linearisieren + Crypto ist unvereinbar), getestet.

---

## C4 — Multi‑Document‑Tabs (§4 V1.1) vs. Einz‑Sitzungs‑Modell
**Beweis/Fakt:** Architektur §2/3 bindet **ein** Backend = **ein** Port = **ein** Auth‑Token =
**eine** Arbeitskopie unter einer Session‑Id. „Session‑Verzeichnis pro Dokument" ist nur
vereinbar mit N Backends oder einer Multi‑Dok‑Arbeitsmenge im Backend — beides ändert §2/3.

Da V1.1: nur **Grundlage** legen (Pfade nach Dokument schlüsseln), Modellwechsel vorher
melden. **Kein Bau in V1.**

**Status: bekannt, für V1 nicht gebaut (V1.1).**

---

## C5 — Merge: AcroForm‑Namenskollision + Link/Outline‑Korrektur (§6) — nicht first‑class
**Beweis:** `PyMuPDF.insert_pdf` erhält Seitengeometrie und kann die Outline übernehmen,
**benennt aber kollidierende AcroForm‑Feldnamen nicht um und schreibt interne Links nicht um**.
Das erfordert `pikepdf`‑Objektchirurgie am merge‑Baum. Machbar, aber nicht „insert_pdf kann das".

**Plan:** in Step 3 zuerst als Spike absichern (Umbenennen + Link‑Rewrite nachweislich), bevor
die Merge‑Route als V1 gilt. **Kein stilles „erledigt".**

**Status: Implementierungs‑Risiko, Spike vor V1‑Zusage.**

---

## Von diesen Entscheidungen nicht betroffen (werden gebaut)
§3‑Parser (FUNDAMENT, fertig), Seitenverwaltung (Rotieren/Löschen/Umsortieren/Einfügen/
Extrahieren/Splitten/Duplizieren), Text‑/Bild‑Stempel, Wasserzeichen, Seitenzahlen,
Flatten, Roteierung (zweistufig), Verschlüsseln/Berechtigungen, Entschlüsseln, Sanitise,
Metadaten‑Scrub, Bilder extrahieren, Bilder→PDF, Komprimieren, Export, Suche,
Seitenlayout, Textauswahl, Annotations‑Werkzeuge + ‑Liste, AcroForm‑Ausfüllen, Outline‑Panel,
Thumbnail‑Multi‑Select + DnD, Dokument‑Eigenschaften, Recent‑Files, Shortcut‑Übersicht,
dokument‑eigene Session‑Grundlage. Diese hängen nicht an C1–C5.

## §9 Signatur‑Erscheinungsbild — dokumentierte Fähigkeitsgrenze (kein C‑Konflikt)
Sichtbares Signatur‑Erscheinungsbild mit Textfeldern (Unterzeichner‑Name, Grund, Ort,
Zeitstempel) und Position‑wie‑Stempel ist implementiert und verifiziert (rund‑trip im
Signatur‑Dictionary `/Name` `/Reason` `/Location` `/M`).

Implementiert und verifiziert:
- **Unsichtbare (nur kryptografische) Signatur:** pyHanko entscheidet Unsichtbarkeit an der
  Null‑Flächen‑Box (`invisible = not(dx and dy)`) — `box=(0,0,0,0)` + `set_hidden_flag` setzt
  das Hidden‑Bit und erzeugt **kein** `/AP`. Verifiziert: Widget `/F`‑Hidden‑Bit gesetzt, kein
  `/AP`, Signatur `valid=True`, Save‑a‑Copy‑Prüfung mit pikepdf.
- **Sichtbare Signatur mit Textfeldern** (Name/Grund/Ort/Zeit): `/AP` vorhanden, Wortlaut im
  Signatur‑Dictionary (`/Name` `/Reason` `/Location` `/M`), Gegenprobe `/AP in widget`.

- **Eigene Bibliotheksgrafik INNERHALB des Appearance‑Streams:** gelöst. PyMuPDF legt das
  Sig‑Widget mit dem Bibliotheks‑PNG als Pixmap‑Erscheinungsbild an (`/AP`), danach signiert
  pyHanko dasselbe Feld mit `existing_fields_only=True` — `/AP` (Grafik) und `/V` (Signaturwert)
  sitzen am selben Widget, Signatur bleibt `valid`. Verifiziert (pikepdf: `/AP` + `/V` am
  Sig‑Widget, `valid/intact` True). Name/Grund/Ort bleiben zusätzlich im Signatur‑Dictionary.
