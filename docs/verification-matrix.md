# Verifikations-Matrix (PART 3 §7.1)

> Maßstab (PART 3 §2/§3): Control existiert nur, wenn **verdrahtet** UND das Ergebnis-PDF auf der
> Platte wie beschriftet geändert hat — bewiesen über den **echten Pfad** (HTTP-Endpoint) mit einer
> **zweiten Bibliothek** und den **Invarianten**. **§3✔** = Route + Zweitbibliothek (pikepdf) bzw.
> erneutes Öffnen der **geschriebenen Datei** + Invariante. **Self-Lib** = mit derselben Bibliothek
> geschrieben und geprüft. Textbasierte Ausgaben (Text/WZ/Zahlen) haben kein unabhängiges Struktur-
> objekt → geprüft durch erneutes Öffnen der **gespeicherten Datei** (PyMuPDF; nicht der In-Memory-
> Mutations-Doc) + Bereichs-Invariante; das ist ehrlich als solches benannt.
>
> Renderer-Eintritt `src/renderer/lib/documents.ts` → `apiClient` (POST). Backend: Seiten-/Stempel-
> Ops über PyMuPDF (`fitz`), pikepdf nur für Verschlüsselung — und hier als unabhängige Prüf-Bibliothek.
> §3-Referenzmuster: `test_merge_verify.py`, `test_reorder_verify.py`, `test_pages_verify.py`,
> `test_content_verify.py`.

| Operation | Control (UID · Datei) | Wirkung | Verdrahtet? | §3-Beweis | Ergebnis |
|---|---|---|---|---|---|
| Rotate (Auswahl/einzeln) | `pg-rot-left/right/180` · PagesToolbar 41/44/47 · `thumb-rotate-${i}` | `/Rotate` ändern | ja → `/pages/rotate[-selection]` | **`test_pages_verify.py`** (pikepdf `/Rotate`==[90,0,90]; Invariante MediaBox+Seitenzahl) | **§3✔** |
| Delete (Auswahl) | `pg-del` · PagesToolbar 53 · `thumb-delete-${i}` | N Seiten löschen | ja → `/pages/delete-selection` | **`test_pages_verify.py`** (pikepdf Breiten==[100,400], Labels==[P1,P4]) | **§3✔** |
| Umsortieren | Drag-drop `thumb-wrap-${i}` → Sidebar | neue Reihenfolge | ja → `/pages/reorder` | **`test_reorder_verify.py`** (pikepdf MediaBox-Reihenfolge==[300,100,200]; Round-Trip) · **E2E: `reorderDrag.spec.ts`** (echter HTML5-Drag Thumbnail 1 -> untere Haelfte Thumbnail 3: MARK-Sequenz exakt [2,3,1,4], Seitenzahl 4) | **§3✔** |
| Duplizieren | `pg-dup` · PagesToolbar 50 | Seiten kopieren | ja → `/pages/duplicate` | **`test_pages_verify.py`** (Breiten==[100,200,300,100]; Originale unverändert) | **§3✔** |
| **Anhängen / Merge** | `sidebar-append` · Sidebar 88 | fremdes PDF anhängen | ja → `/pages/merge` | **`test_merge_verify.py`** (pikepdf Seitenzahl+`/Outlines`; fitz Text/TOC/Links; Invarianten Ziel/Feldnamen/Links) | **§3✔** (TOC-Verlust gefixt) |
| Seiten einfügen | `pg-insert`→`insert-run` · PagesDialogs 206 | leer/Bild/PDF an Position | ja → `/pages/insert` | **`test_pages_verify.py`** (dims==[(100,100),(250,80),(300,100)]; Index statt Ende) · **E2E: `insertAtIndex.spec.ts`** (echte UI: leer vor Seite 2 → pikepdf auf /document/file: MARKs 1,0,2,3 = Index korrekt, Nachbarn unverändert) | **§3✔** |
| Seiten extrahieren | `pg-extract`→`extract-run` · PagesDialogs 79 | Teil-PDF, Quelle gleich | ja → `/pages/extract` | **`test_pages_verify.py`** (created==[200,300]; **Quelle auf Platte unverändert**) | **§3✔** |
| Splitten | `pg-split`→`split-run` · PagesDialogs 125 | in Teil-PDFs zerlegen | ja → `/pages/split` | **`test_pages_verify.py`** (flach==Original [100..500]; Summe 5; Parts [2,2,1]) · **E2E: `splitOrder.spec.ts`** (echte UI alle-2-Split → 2 Dateien, pikepdf: Summe 4, Verkettung == Originalreihenfolge, Quelle SHA-unveraendert) | **§3✔** |
| Stempel (Bild) | `pg-stamp-image` (armt) → `stampimg-run` | Bild auf Seiten | ja → `/stamps/image` | **`test_content_verify.py`** (pikepdf: `Do`/Image **genau** auf gewählter Seite; Größe ±1 pt) · **E2E: `imageStampRegion.spec.ts`** (Bild bewaffnet via pickImage/readImageAsBase64-Stub, Region auf Seite 1 gezogen, cm-Matrix e/f/a/d == Region x/y+h/B/H je ±1 pt, Seite 2 bildfrei) | **§3✔** |
| Stempel (Text) | `pg-stamp` (armt) → `stamp-run` | Textstempel | ja → `/stamps/text` | **`test_content_verify.py`** (gespeicherte Datei reopen: im Bereich da, außerhalb weg) · **E2E: `stampCoordinates.spec.ts`** (Werkzeug bewaffnen, Canvas-Punkt klicken, Tm-Baseline per pikepdf auf (x, 842−y) ±1 pt, nur Seite 1, MARKs heil) | **§3✔** (Text via Datei-Reopen) |
| Wasserzeichen | `pg-watermark`→`watermark-run` · PagesDialogs 302 | WZ im Bereich | ja → `/stamps/watermark` | **`test_content_verify.py`** (Datei-Reopen: Bereich [S1,S3] da, S2 weg) · **E2E: `watermarkRange.spec.ts`** (echte UI 2-3 → pikepdf /document/file: FTTF-Bereich, alle Original-MARKS erhalten) | **§3✔** (Text via Datei-Reopen) |
| Seitenzahlen | `pg-numbers`→`numbers-run` · PagesDialogs 254 | Nummerierung im Bereich | ja → `/stamps/page-numbers` | **`test_content_verify.py`** (Datei-Reopen: SEITE-7/8 im Bereich, außerhalb keine) · **E2E: `pageNumbersRange.spec.ts`** (echte UI 2-3, Format SEITE{n}: Zähler beginnt bei start=1 auf der ERSTEN gewählten Seite — .SS. + .12. + alle MARKs, pikepdf /document/file) | **§3✔** (Text via Datei-Reopen) |
| Flatten | `pg-flatten`→`flatten-run` · PagesDialogs 406 | Annotationen/Formulare | ja → `/document/flatten` | **`test_content_verify.py`** (pikepdf `/Annots`==0 nach Flatten; Seitenzahl-Invariante) · **E2E: `formFillFlatten.spec.ts`** (echtes Formular-Layer-Feld + Flatten-Dialog; danach /AcroForm-Felder==0, Wert im Seiteninhalt, FIXTEXT heil) | **§3✔** |

<!-- REGISTRY-MATRIX:BEGIN -->
## Per-Control-Matrix (§7.1 — generiert aus der Registry-Reihenfolge, Guard: scripts/verification-matrix.mjs + tests/renderer/matrixSync.test.ts)
Spalte „verifiziert durch" nennt den Beweis mit seiner Assertion; `Datei:` = Backend-Test über den
echten HTTP-Pfad mit Ausgabe-Datei + Zweitbibliothek, `UI:` = Renderer-Test. „OFFEN" = Beweislücke
beim Namen.

| Befehl | Wirkung | verifiziert durch | Ergebnis |
|---|---|---|---|
| `pg.rotLeft` | Seiten -90° | Datei: `test_pages_ops.py::test_route_rotate_then_undo` (/Rotate via pikepdf, Seitenzahl konstant) · UI: `thumbnailContextMenu.test.tsx` (echter POST body expr '2', delta -90) | ✔ |
| `pg.rotRight` | Seiten +90° | wie `pg.rotLeft` (delta +90; e2e `operations.spec.ts` Rechtsklick→save→/Rotate 90 im File) | ✔ |
| `pg.rot180` | Seiten 180° | Datei: `test_route_rotate_then_undo`-Familie (rotate-selection Ausdruck) · UI: `viewerContextMenu.test.tsx` (Canvas-Scope aktuelle Seite) | ✔ |
| `pg.duplicate` | Seiten kopieren | Datei: `test_pages_ops.py::test_route_duplicate_then_undo` (/Count, Kopie unabhängig rotierbar) + `test_duplicate_before_position_and_order_preserved` · UI: `pagesToolbarRegistry.test.ts` + `operations.spec.ts` (DOM+File) | ✔ |
| `pg.delete` | Seiten löschen | Datei: `test_pages_ops.py::test_delete_guard_refuses_all` + `test_route_delete_all_is_422` + Undo-Familie (fehlende Labels) · UI: `thumbnailContextMenu.test.tsx` (POST expr '2'), `operations.spec.ts` (File /Count) · E2E: `deletePage.spec.ts` (pikepdf: MARK-P2 fort, P1 vor P3, 2 Seiten) | ✔ |
| `pg.insert` | Seiten einfügen | Datei: `test_insert_blank_position_and_blank` (an Index, nicht ans Ende) + `test_insert_pdf_all_at_start`/`_range`/`_scale` + `test_route_insert_then_undo` · UI: `pagesToolbarOverflow.test.tsx` (Dialog-Opening) | ✔ |
| `pg.extract` | Seiten extrahieren | Datei: `test_pages_ops.py::test_extract_single_file_source_unchanged_order` + `test_extract_each_page` + `test_extract_never_overwrites` (§2.1) + `test_route_extract_leaves_source_unchanged` · E2E: `extractUnchanged.spec.ts` (1-Seiten-Datei mit MARK-P2; Quelle SHA-256-identisch) | ✔ |
| `pg.split` | Split | Datei: `test_pages_ops.py::test_split_everyN`/`test_split_points`/`test_split_every` + `test_route_split` (Summen + Reihenfolge) + `test_split_rejects_single_result` | ✔ |
| `pg.numbers` | Seitenzahlen | Datei: `test_page_numbers_start_offset` + `test_content_verify.py::test_page_numbers_present_in_range_absent_outside` + `test_route_pagenumbers_then_undo` | ✔ |
| `pg.watermark` | Wasserzeichen | Datei: `test_watermark_selection_only` + `test_content_verify.py::test_watermark_present_in_range_absent_outside` + `test_route_watermark_then_undo` | ✔ |
| `pg.removeSigs` | Digitale Signaturen entfernen | Datei: `backend/tests/test_remove_signatures_verify.py` (echter HTTP-Pfad; Zweitbibliothek pikepdf+PyMuPDF sehen 0 Sig-Felder; NICHT-Aenderung: Text/Seiten gleich; Undo stellt Signatur exakt wieder her) · UI: `tests/renderer/commands.test.ts` (nur bei signedDoc, zerstoererisch, im PDF-Fluegel) | ✔ |
| `pg.sortPages` | Seiten sortieren | Datei: `test_reorder_verify.py` + `test_pages_verify.py::…reorder…` (zweite Bibliothek) · UI: `reorder.test.ts` (Griff->Ziel->POST /pages/reorder) + `ctxMenuLevels.spec.ts` (Menueeintrag im PDF-Fluegel oeffnet die Thumbnail-Leiste) | ✔ |
| `ins.sigField` | Signaturfeld einfügen | UI: `tests/e2e/browser/sigField.spec.ts` (Menü/Arm -> Overlay auf Platte; Ziehen/Verschieben/Skalieren -> Rect auf Platte; Signieren -> /Sig-Widget mit eigenem AP-Schild auf Platte, ByteRange intakt) | ✔ |
| `pg.stampText` | StempelText | Datei: `test_text_stamp_with_placeholders` + `test_content_verify.py::test_text_stamp_present_in_range_absent_outside` (Koordinaten) · UI: Menüeintrag `thumbnailContextMenu.test.tsx` | ✔ |
| `pg.stampImage` | Stempel-Bild | Datei: `test_route_image_stamp` + `test_image_stamp_applies_to_selection` + `test_content_verify.py::test_image_stamp_second_lib_exact_pages_and_size` | ✔ |
| `pg.images` | Bilder-Panel | Datei: `test_list_images_reports_resolutions` + `test_extract_images_source_unchanged_and_suffix` + `test_route_extract_images` · UI: `pagesDialogs.test.tsx` (Liste→Ziel→Run: POST `/document/extract-images` mit expr+destDir) | ✔ |
| `pg.flatten` | Ebenen zusammenfassen | Datei: `test_content_verify.py::test_flatten_removes_annots_second_lib` (/Annots==0, Seitenzahl-Invariante) · UI: `pagesDialogs.test.tsx` (Run sendet genau die angeklickten Kategorien an `/document/flatten`) | ✔ |
| `pg.export` | Export Text/Bilder | Datei: `test_export.py::test_export_images_png_and_dpi` + `test_export_text_writes_file` + `test_document_text_and_markdown` | ✔ |
| `pg.selectAll` | Alles auswählen | UI: `selection.test.ts` (Store-Vollständigkeit) — kein Dokumenteffekt per Design | ✔ |
| `pg.insertBefore` | Seite davor einfügen (nur Kontextmenü, §6) | UI: `thumbnailContextMenu.test.tsx` (Klick → `openPagesDialog('insert',{position:'before',page:Scope-Start})`) + `pagesDialogs.test.tsx` (Dialog vorausgefüllt → POST `/pages/insert` before+2) · Datei: `test_pages_ops.py::test_insert_blank_position_and_blank` (an Index, nicht ans Ende) | ✔ |
| `pg.insertAfter` | Seite danach einfügen (nur Kontextmenü, §6) | UI: `thumbnailContextMenu.test.tsx` (Menüpunkt + preset after) · Datei: wie `pg.insertBefore` (before/after-Pfad desselben Endpunkts) | ✔ |
| `pg.splitBefore` | Vor dieser Seite teilen (nur Kontextmenü, §6) | UI: `thumbnailContextMenu.test.tsx` (Klick → preset `split mode 'at' page 2`) + `pagesDialogs.test.tsx` (POST `/pages/split` at+3) · Datei: `test_pages_ops.py::test_split_points` (Punkt-Split, Summen + Reihenfolge) | ✔ |
| `pg.clear` | Auswahl leeren | UI: `selection.test.ts` — kein Dokumenteffekt per Design | ✔ |
| `view.fitWidth` | Breite anpassen | UI: `viewerContextMenu.test.tsx` (Scale == breiteste Seite) + `commands.test.ts` (Zoom-State) — kein Dokumenteffekt | ✔ |
| `view.fitPage` | Seite anpassen | UI: `pagesToolbarOverflow.test.tsx` (Overflow→fitPage) + `commands.test.ts` — kein Dokumenteffekt | ✔ |
| `view.zoom100` | 100 % | UI: `commands.test.ts` (Zoom-State nach Dispatch) — kein Dokumenteffekt | ✔ |
| `ann.edit` | Annotation bearbeiten | Datei: `test_annotations.py::test_routes_edit_delete_undo` · UI: `annotationContextMenu.test.tsx` (ctx-ann-edit setzt `selectedAnnotationId` im echten Store → Editor öffnet sich) | ✔ |
| `ann.toolHighlight` | Hervorhebung platzieren (Canvas-Menü, §6) | UI: `viewerContextMenu.test.tsx` (Menüpunkt + Klick → `markupTool==='Highlight'`) + `commands.test.ts` (alle sechs, Doku-/readOnly-Gate) · Datei: `test_families_verify.py::test_add_annotation_output_file` (derselbe POST-Pfad: Subtyp/Rect/Author, Zweitbibliothek) | ✔ |
| `ann.toolUnderline` | Unterstreichen platzieren | UI: `viewerContextMenu.test.tsx` (Menüpunkt-Klick bewaffnet echtes Werkzeug, Muster zu toolHighlight) · Datei: `test_families_verify.py::test_add_annotation_output_file` (Subtyp Underline) | ✔ |
| `ann.toolStrikeOut` | Durchstreichen platzieren | UI: `commands.test.ts` (alle sechs bewaffnen Store-Werkzeug) · Datei: `test_families_verify.py::test_add_annotation_output_file` (Subtyp StrikeOut) | ✔ |
| `ann.toolSquiggly` | Wellenlinie platzieren | UI: `commands.test.ts` (bewaffnet `markupTool==='Squiggly'`) · Datei: wie `ann.toolHighlight` | ✔ |
| `ann.toolNote` | Textnotiz platzieren | UI: `viewerContextMenu.test.tsx` (Klick → `markupTool==='Text'`) · Datei: wie `ann.toolHighlight` | ✔ |
| `ann.toolFreeText` | Freitext platzieren | UI: `commands.test.ts` · Datei: wie `ann.toolHighlight` | ✔ |
| `ann.delete` | Annotation löschen | Datei: `test_annotations.py::test_routes_edit_delete_undo` (Annotation weg, Undo zurück) · UI: `annotationContextMenu.test.tsx` (ctx-ann-delete → POST `/document/delete-annotation` mit der Zeilen-ID) | ✔ |
| `ts.copy` | Auswahl kopieren | UI: `pageCanvasSelection.test.tsx` (Quelle rect/page) + `textSelectionCommands.test.ts` (clipboard.writeText) — kein Dokumenteffekt | ✔ |
| `ts.highlight` | Hervorheben | Datei: `test_families_verify.py::test_add_annotation_output_file` (Subtyp/Rect/Author auf Datei, Zweitbibliothek) · UI: `textSelectionCommands.test.ts` (addAnnotation-Body: page0 0-basiert, PDF-Rect) · Live-Werkzeugpfad inkl. Rect-Beweis: `annotationNote.spec.ts` (Text-Notiz; Highlight-Rects snappen per Definition auf Glyph-Quads) | ✔ |
| `ts.underline` | Unterstreichen | wie `ts.highlight` (Typ underline) — UI: `textSelectionCommands.test.ts` | ✔ |
| `ts.strikeout` | Durchstreichen | wie `ts.highlight` (Typ strikeout) — UI: `textSelectionCommands.test.ts` | ✔ |
| `ts.redact` | Schwärzen | Datei: `test_families_verify.py::test_redaction_string_not_extractable_on_disk` (String NICHT mehr extrahierbar — Kern-Assertion) · UI: `textSelectionCommands.test.ts` (1-basierte Seiten im Body, destruktiver Gate) · **E2E: `redactSelection.spec.ts`** (echte Wortselektion + Rechtsklick-Menü; pymupdf/pikepdf auf /document/file: GEHEIM123 nicht extrahierbar, SICHERTEXT heil) | ✔ |
| `ts.askAi` | KI fragen | UI: `textSelectionCommands.test.ts` (AI-Store: Tab + Frage) — kein Dokumenteffekt per Design | ✔ |
| `file.open` | Öffnen | Datei: /document/open in fast jedem Backend-Test · UI: `fileMenu.test.tsx` (Dispatch) · E2E: `tests/e2e/browser/rotateUndo.spec.ts` klickt `tb-open` gegen echtes Backend und öffnet die Fixture (Dialog-Schicht stubbt nur den nativen Pfadpicker) — OFFEN: nativer Electron-Dialog selbst; Runde 49 GESCHLOSSEN bis auf den OS-Picker selbst: `electron-builder --linux --dir` repariert und das GEPAKTE Binary laeuft die Electron-Lane `smoke.spec.ts` + `operations.spec.ts` 4/4 (Start, argv-Open, Thumbnail-Rotation, echter Rechtsklick, Save, sauberer Shutdown inkl. Backend-Terminierung). OFFEN bleibt nur der native OS-Dateiauswahl-Dialog selbst (Prozessgrenze, nicht automatisierbar; Stroeme dazu sind ueber den Stub bewiesen) | ✔ Datei / ✔ gepackte App |
| `file.encrypt` | Verschluesseln (AES-256, Dialog) | Datei: `test_families_verify.py::test_encrypt_aes256_second_lib` (pikepdf: ohne PW PasswordError, /CFM AESV3 /Length 256 /R6) · **E2E: `encryptDialog.spec.ts`** (Panel-Button -> Dialog -> Passwort -> Strg+S auf Platte: gespeicherte Datei ohne PW zu, mit PW offen, AESV3/256/R6, 2 Seiten, MARKs mit PW extrahierbar) | ✔ |
| `file.save` | Speichern | Datei: `test_lifecycle.py::test_normal_save_keeps_binding_and_clears_dirty` · UI: `fileMenu.test.tsx` | ✔ |
| `file.saveAs` | Speichern unter | Datei: `test_lifecycle.py::test_save_as_rebinds` | ✔ |
| `file.saveCopy` | Kopie speichern | Datei: `test_lifecycle.py::test_save_a_copy_does_not_rebind` (Original-Bindung bleibt) | ✔ |
| `file.close` | Schließen | Datei: `test_lifecycle.py::test_close_resets_session` | ✔ |
| `edit.undo` | Rückgängig | Datei: `test_pages_ops.py::test_undo_restores_snapshot_byte_identical` (SHA-256 gleich + pikepdf-Öffnen) + `test_undo_redo_rotate_cycle_keeps_page_count` · UI: `globalCommands.test.ts` (canUndo-Gate) | ✔ |
| `edit.redo` | Wiederholen | Datei: `test_core.py::test_new_mutation_discards_redo_branch` + `test_encrypt_clears_undo_and_redo_history` (Redo-Stack-Semantik) | ✔ |
| `text.selectAll` | Alles auf Seite | UI: `globalCommands.test.ts` (Store-Auswahl vollständig) — kein Dokumenteffekt | ✔ |
| `app.settings` | Einstellungen | UI: `globalCommands.test.ts` (Zeile 36: echte Stores) — kein Dokumenteffekt | ✔ |
| `app.debug` | Debug-Panel | UI: `globalCommands.test.ts` — kein Dokumenteffekt | ✔ |
| `app.shortcuts` | Tastatur-Übersicht | UI: `globalCommands.test.ts` — kein Dokumenteffekt | ✔ |
| `app.fullScreen` | Vollbild | UI: `globalCommands.test.ts` (Dispatch auf Store/Browser-API stubsicher) — kein Dokumenteffekt | ✔ |
| `search.open` | Suche öffnen | UI: `globalCommands.test.ts` (useSearchStore.open false→true, Zeilen 77–80) | ✔ |
| `search.next` | nächster Treffer | UI: `globalCommands.test.ts` (Store-Zeiger) | ✔ |
| `search.prev` | vorheriger Treffer | UI: `globalCommands.test.ts` (Store-Zeiger) | ✔ |
<!-- REGISTRY-MATRIX:END -->

## REMOVED — NOT IMPLEMENTED (§7.2)
**Kein Control entfernt.** Kein `pg-*`-, Stempel-, Wasserzeichen- oder Nummerierungs-Control ist tot:
jedes ruft direkt einen `documents.ts`-Mutator auf oder öffnet einen Dialog, dessen Run-Button einen
aufruft (Stempel-Toolbar-Buttons *armen* nur; POST kommt im Dialog — zweistufig, nicht tot). Die
PART-3-Prämisse „die meisten Seiten-Ops tun nichts" bestätigt sich im aktuellen Stand **nicht**.

## NOT WORKING
(nichts offen — der letzte Eintrag „Signatur auf der gespeicherten Datei" wurde in Runde 19 behoben, siehe unten „Behoben".)

## Behoben — Signatur überlebt das Speichern (§3/§2, Runde 19)
- **Früher (echter Defekt):** `POST /document/save` speicherte die signierte Arbeitskopie mit
  `pikepdf.save` neu -> Objekte werden umgeschrieben, Dateigröße ändert sich, die `ByteRange`-
  Offsets der pyHanko-Inkrement-Signatur zeigen hinter das Dateiende -> die Ausgabedatei enthält
  zwar ein `/Sig`-Wort, aber eine **brechende Schein-Signatur** (Validierung schlägt fehl).
- **Jetzt:** `pdflib.save_document` erkennt eine signierte Arbeitskopie (`fitz.get_sigflags()`) und
  kopiert sie **byte-genau** (`shutil.copyfile`) statt umzuschreiben; eine nachträgliche
  Verschlüsselung eines signierten Dokuments wird mit `WriteDenied` abgelehnt, statt die Signatur
  still zu zerstören. **Beweis:** `backend/tests/test_families_verify.py::
  test_signed_file_survives_save_valid_with_full_byterange` — über die echten Endpunkte:
  gespeicherte Datei ist byte-identisch zum validierten `/document/file`-Strom, `/ByteRange` deckt
  den Gesamtumfang (`o1==0 && o2+l2==size`), MuPDF liest das Signatur-Objekt, beide Textmarker +
  Seitenzahl bleiben, und Tampering -> über `/document/open` + `/document/signatures` erneut
  geprüft -> `intact/valid` schlägt fehl. Backend-Suite 318 grün.

## Absichtlich wirkungslos auf das Dokument (nicht tot)
- `view-rot-left`/`view-rot-right` (TopBar 158/159): reine **Ansichts**-Rotation (`useUiStore`), kein
  HTTP — per Design (§6 führt „Ansicht drehen" als Ansichts-Aktion).

## Verifikations-Schulden (Rest)
- **Undo = Byte-Identität (§3-Zeile) — JETZT BEWIESEN (Runde 18):**
  `backend/tests/test_pages_ops.py::test_undo_restores_snapshot_byte_identical`: über den echten
  Endpunkt `/document/file` (dieselben Bytes, die der Renderer sieht) — vor der Rotation, mittel
  `rotate-selection` (muss sich unterscheiden) und nach `/document/undo`; SHA-256(before) ==
  SHA-256(after); die Undo-Kopie öffnet zusätzlich mit der zweiten Bibliothek (pikepdf, 3 Seiten).
  Passt zum Mechanismus in `session.py` (`work = copy(undo_stack.pop)` — Byte-Kopie, kein Re-Write).
- **Fit-Width-Gutter-Frame-Fehler behoben (§4):** die initiale Box-Messung nutzte `clientWidth`
  (inklusive `p-6`-Padding = 48 px) und war damit einen Frame zu breit -> mögliche
  Horizontal-Scrollbar bei Fit-Width; jetzt `innerBox(clientW-padX, clientH-padY)` mit
  Computed-Style-Padding, semantisch gleich `ResizeObserver.contentRect`. Beweis:
  `innerBox.test.ts` (2) + AppShell-Verdrahtung (tsc); RO-Pfad war bereits korrekt.
- **Signatur — gespeicherte Datei:** `/document/save` UND `/document/file` liefern eine normalisierte
  Kopie OHNE Signatur-Inkrement (12 Objekte, kein `/Sig`, kein `/ByteRange`). → "gespeicherte Datei
  traegt eine validierende Signatur mit vollem Byte-Range" ist **NOT WORKING** (Begriff unten).
  Integritaet + Tamper-Erkennung funktionieren nur auf der Sitzungs-Kopie (siehe Familien-Tabelle).
- **Eigene Dokument-Seitenlabels (§4) — geliefert (Runde 17):** `AppShell` liest einmalig
  `doc.getPageLabels()` (pdfjs 4.10) und speist `labelFor` in `PageColumn` UND `FacingColumn`
  (Format „iv (4)“, sonst „4“). **Beweis:** `pageLabels.test.tsx` (3: Helper — eigener Label nur
  wo definiert, leer/null -> Nummer, Trim; beide Spalten rendern `page-label-*`/`facing-label-*`
  mit eigenem Label). Die pdfjs-Doku-Zeile ist Integrationstest-mäßig nur tsc + Props-Beweis
  (echter Stream erst im gated E2E), hier ehrlich als solche benannt.
- **Kontext-Menü-Taste LIVE bewiesen (Runde 47):** `page-slot-N` ist jetzt selbst fokussierbar
  (tabIndex + aria-label); eigener Keydown-Handler (ContextMenu-Taste UND Shift+F10) in
  ThumbnailList + AppShell. Beweis: `keyboardMenu.spec.ts` (LIVE: Slot-Fokus -> Shift+F10 ->
  Menue -> `ctx-pg-rot-right` -> Save -> Plattendatei `R1=90 R2=0 N=2` per pymupdf) und
  `thumbnailContextMenu.test.tsx` (Taste + Shift+F10 am Thumbnail-Fokus, Scope-Label korrekt).
  Die o.g. fruehere Zeile war eine Abswaechung (synthetisches Event im jsdom); jetzt echter
  Nutzerpfad durch die laufende Anwendung.
- **Kontext-Menü-Taste (§6) — Thumbnail jetzt fokussierbar:** `tabIndex=0` am `thumb-wrap-i`;
  Beweis `thumbnailContextMenu.test.tsx` (+1: `wrap.focus()` -> `document.activeElement`, danach
  contextmenu-Event (genau das, was die Browser-Taste auf dem fokussierten Element feuert) öffnet
  das Seitemenü). Menü-Tastatur (Pfeile/Enter/Esc) war bereits verifiziert.
- **E2E je Feature: SPEC GELIEFERT, AUSFÜHRUNG GATED (§3):** `tests/e2e/operations.spec.ts`
  (3 Tests: Duplizieren `pg-dup` → DOM `/ 2` + Datei `/Count 2` und kein `/Count 1`; Löschen
  Thumbnail-Auswahl + `pg-del` → DOM `/ 1` + Datei `/Count 1`; Canvas-Rechtsklick →
  `ctx-pg-rot-right` → Save → Datei `/Rotate 90`) plus `smoke.spec.ts` (öffnen→drehen→save→
  gültiges PDF). Kompiliert und von `npx playwright test --list` gefunden (4 Tests/2 Dateien);
  AUSGEFÜHRT hier nicht — Environment ohne X-Server und ohne Electron-Binary (harte Gate wie bei
  smoke). Datei-Leser im Test ist das rohe `/Count`/`/Rotate` der Plattendatei, nicht die
  Schreib-Pipeline.
- §7.4-Rest: **Playwright-DOM-Geometrie/E2E** (Gated: Electron-Binary + Display). Zoom-Anker,
  Aktuelle-Seite-per-Viewport und Doppelseiten-Parität sind Modell + DOM bewiesen und verdrahtet;
  seit Runde 38 auch LIVE im Chromium belegt (`facingParity.spec.ts`) — inklusive Produkfix
  Facing-Fit gegen halbe Breite (vorher horizontaler Scrollbalken in Doppelseiten-Ansicht).
- **Erledigt §3✔:** alle 13 Seiten-/Inhalts-Ops **und** die Funktionsfamilien Annotationen,
  Formulare (Fill+Flatten), Schwärzung, Verschlüsselung (AES-256), Metadaten, Signatur-Integrität.

## Funktionsfamilien (PART 3 §3) — `test_families_verify.py`
| Familie | Route | §3-Beweis (Output-Datei, Zweitbibliothek) | Ergebnis |
|---|---|---|---|
| Annotationen | `/document/add-annotations` | pikepdf `/Annots` → `/Subtype /FreeText`, `/Rect==[50,60,130,90]`, `/T==Autor`, `/Contents`; Seitenzahl-Invariante · **E2E: `annotationNote.spec.ts`** (Panel→Werkzeug→echter Drag→Dialog: /Subtype /Text, Rect-Ankerkanten == gezogene Region ±1 pt, /T, /Contents, Popup-Kind praesent, MARKs extrahierbar, Seite 2 annotfrei) | **§3✔** (FreeText-Bug gefixt) |
| Formulare (Fill) | `/document/fill-form` | pikepdf `/AcroForm/Fields` `/V=="Ben"` auf gespeicherter Datei · **E2E: `formFillFlatten.spec.ts`** (Fill per blur -> pikepdf /AcroForm /V==AUSGEFUELLT) | **§3✔** |
| Formulare (Flatten) | `/document/flatten [forms]` | pikepdf `/AcroForm` entfernt/leer · **E2E: `formFillFlatten.spec.ts`** (pg-flatten per Klick -> /Fields==0, Wert im Inhalt) | **§3✔** |
| Schwärzung | `/redaction/apply` | Datei-Reopen: `"TOPSECRET"/"4242"` **nicht extrahierbar**, `"PUBLIC"` erhalten | **§3✔** |
| Verschlüsselung | `/document/encrypt`+save | pikepdf: ohne PW → `PasswordError`; mit PW offen; `/CF//StdCF//CFM==/AESV3`, `/Length 256`, `/R 6` | **§3✔** (AES-256) |
| Metadaten | `/document/metadata` (Sidebar-Panel; kein Registry-Befehl) | pikepdf docinfo: Title/Author/Subject/Keywords lesbar; `/Creator` **nicht gelöscht** · **E2E: `metadataWrite.spec.ts`** (echte Feld-Edits + Speichern; GET /document/file zeigt NEUER-TITEL/NEUER-AUTOR, CREATOR-FIX/PRODUCER-FIX erhalten) | **§3✔** |
| Signatur (Integrität) | `/document/sign` | GET `/document/signatures`: sign→`intact&valid==True`; danach echte Änderung (`/pages/rotate`)→nicht mehr gültig · **E2E: `signaturePanel.spec.ts`** (Panel+Describe+Signieren+Strg+S: Plattendatei `get_sigflags()` signiert, /ByteRange o1==0 und o2+l2==Dateigröße, MARKs heil; Tamper über echten Endpunkt neu geöffnet → ungültig) | **§3✔** (Tamper erkannt) |
| Signatur (Save-Datei) | — | Save-Datei enthält **kein** `/Sig`/`/ByteRange` → validiert nicht auf Platte | **NOT WORKING** |

**Gefixter Defekt:** `annotation_ops.add_annotation` rief `Page.add_freetext(...)` (existiert nicht)
→ FreeText-Annotation schlug fehl. Fix: `Page.add_freetext_annot(...)`. Bewiesen durch
`test_add_annotation_output_file` (pikepdf `/FreeText` auf der gespeicherten Datei).

## Browser-E2E (PART 3 §3, letzte Lücke teilweise geschlossen — Runde 28)
## GEBEAUT UND BEWIESEN — gepackte App-Binary-Lane (Runde 49, ersetzt den NOT-WORKING-Eintrag)
- URSPRUNG der Builder-Schema-Meldung war eine einzige falsche Ebene: `linux.desktop.Entry`
  -> korrekt `linux.desktop.entry` (electron-builder 26: LinuxDesktopFile kennt nur
  entry/desktopActions). Nach dem Fix baut `--linux --dir` sauber.
- Zwei weitere, vorher kaschierte Befunde auf dem Weg: (1) `out/` war ein STALEN-Build vom
  Vortag — die Electron-Lane lief gegen totem Renderer (erkennbar an fehlenden Testids);
  (2) das gefrorene PyInstaller-Backend im Paket war ebenfalls veraltet (404 auf
  /document/form-fields). Beide Neu-Builds (electron-vite build + PyInstaller onedir) sind
  now Teil des Repariers; `scripts/build.sh` beschreibt beide Schritte ohnehin.
- NEUER PRODUKT-DEFEXT (#8, im Smoke gefunden): App.tsx veroeffentlichte Backend-Status
  'ready' IM STORE, BEVOR initApiClient Token/Port geholt hatte -> der argv-Open-Effekt der
  AppShell feuerte ohne initialisierten Client und das per Desktop-%f geoeffnete Dokument
  blieb leer. Fix: Init zuerst, Status danach (App.tsx). Beweis: smoke.spec.ts Schritt 2
  (`page-count` == '/ 1' nach argv-Start) war vor dem Fix rot und ist jetzt gruen.
- Smoke/operations-Specs an die aktuelle UI angepasst: echtes Testid-Handling (tb-open),
  Overflow-Fallback clickToolbar (pg-dup/pg-del -> pages-more -> ctx-*), Rechtsklick auf den
  Seitenkasten statt Canvas (Text-Ebene intercepts), und app.close() durch den ECHTEN
  Nutzerweg ersetzt (win.close() -> window-all-closed -> cleanShutdown; Playwrights
  Browser-Close triggert diesen Pfad nicht und hing ins Leere).
- Electron-Lane 4/4 gruen gegen dist/electron/linux-unpacked/pdf-editor (8,6 s).

## Smartcard-Lane Runde 52 — PKCS#11: echte Karte gelesen, Signatur-Flow bereit
- Backend `backend/pkcs11_ops.py` + Routes `/pkcs11/devices`, `/pkcs11/certificates`,
  `/document/sign-pkcs11` (Session-Mutation; PINs nur als Argument, nie geloggt/persistiert;
  Signaturen-Pfad = dieselbe crypto_ops.sign_with_signer-Schreibstelle wie .p12, refactored
  ohne Verhaltensaenderung: alle 40+ Signaturtests weiterhin gruen).
- **Echte Karte im echten Leser** (IDEMIA, Alcor, OpenSC-Modul): Backend-Test
  `test_smartcard.py` ueber HTTP: Geraete + Zertifikate ohne PIN lesbar, Signatur-Zert
  ("Allkirjastamine", id 02 an PIN2-Slot) mit Subjekt/Algo ECDSA-SHA512 — skipped nur,
  wenn keine Karte steckt. UI-E2E `smartcardPanel.spec.ts` (LIVE, 1.8 s): "Karte lesen" ->
  Geraeteliste -> Zertifikat mit Subjekt waehlbar, PIN-Feld ist password-type.
- Signieren selbst fuehrt der Nutzer mit seiner PIN aus (PIN-Sperrrisiko -> bewusst kein
  automatisierter Fehl-PIN-Test). Karten-Konvention gemessen: Schlussel teilt CKA_ID des
  Zertifikats; Signatur-PIN (PIN2) als optionales Feld gefuehrt.
- python-pkcs11 deklariert (requirements + PyInstaller collect_all).

## Browser-E2E Runde 51 — Objekt-Nachbearbeitung, Speichern unter sichtbar, Ueberschreib-Warnung, JPEG-Vorschau
- **Objekt-Bearbeitung nach Einbetten**: Doppelklick auf eingebettetes Bild waehlt es
  (PageCanvas meldet PDF-Koordinaten; Hit-Test gegen /document/image-objects). Overlay mit
  Move-Rahmen, 4 Eck-Handles, "90° drehen" (setzt getauschtes Zielrechteck — insert_image
  rotiert im Frame, live gemessen) und "Objekt loeschen". Backend: Region-Redaction
  (images=REMOVE, text/graphics=NONE) entfernt INSTANZ-genau (Gegentest: page.delete_image
  blieb wirkungslos; zwei gleiche xref-Instanzen: nur die getroffene verschwindet, Text heil).
  Backend-Beweis: `test_image_object_edit_move_scale_rotate_delete` (echte HTTP-Pfade,
  pikepdf auf Ausgabedatei, Textunversehrtheit, BBox-Tausch als Dreh-Beweis).
  Live-Beweis: `objEdit.spec.ts` — Drop->Einbetten->Save, Doppelklick->Frame, Move +80/60px
  -> Plattendatei: BBox-Mitte wandelt mit (>60% der Soll-Verschiebung), Drehen -> BBox
  Hoch/Quer-Tausch, Loeschen -> N=0 und MARK-P1 bleibt.
  Cache-Fall griffen: get_image_info() bedient nach apply_redactions Altdaten (live
  reproduziert) -> Zaehler nutzt get_images(); import fitz (deprecated) vergiftete den
  Backend-Startup-stdout und brach das Token-Handshake — auf `import pymupdf as fitz` gestellt.
- **Speichern unter**: Flow existierte (Menue + Strg+Umschalt+S), war aber nirgends sichtbar —
  TopBar-Btn `tb-save-as`. Live-Beweis `saveAsOverwrite.spec.ts`: SaveAs in neues Ziel,
  Original unveraendert (pymupdf auf BEIDE Dateien).
- **Ueberschreib-Warnung**: GTK-Dialog kennt showOverwriteConfirmation nicht — stattdessen
  plattformunabhaengig: /fs/exists + Bestaetigungsdialog; Abbruch laesst Zielbytegroesse
  unveraendert (im Test auf die Platte gemessen), Bestaetigung ueberschreibt.
- Nutzerbefund "Signatur-Vorschau haut nicht hin": Vorschauen/Overlay hart als image/png
  deklariert -> importierte JPEG schlaegt im Browser fehl. `imageMime.ts` leitet MIME aus
  fileName/Extension ab. Live-Beweis `sigPreviewJpeg.spec.ts`: echtes JPEG importiert,
  naturalWidth>0 UND currentSrc == data:image/jpeg;base64, Platzierung im Dokument.

## Browser-E2E Runde 50 — Grafik-Platzierung (Drop->Vorschau->Region->Einbetten) + Bildformate
- Nutzerfluss: Grafik-Datei ins Fenster droppen (oder Signatur-Bibliothek "Platzieren") ->
  PlacementBar mit Vorschau -> Region auf beliebiger Seite ziehen (Overlay zeigt die Grafik)
  -> "Einbetten" (Stempel-Mutator, undo-faehig) -> Save schreibt sie ins Dokument.
  Beweis: `placeGraphic.spec.ts` (LIVE): Drop -> Bar -> Drag -> Apply -> Strg+S; Plattendatei:
  gezeichnetes Bild nur auf Seite 1 (get_image_info bbox == gezogene Region), Seite 2 ohne
  Placement, MARKs heil.
- Nutzerbefund "unknown image file format" (SVG-Stempel): Backend normalisiert jetzt alle
  Nicht-PNG/JPEG-Grafiken (Pillow, SVG via MuPDF-Dokumentparser -> PNG) vor dem Einfuegen,
  fuer Stempel UND Signatur-Stempel. Beweis: `test_svg_and_webp_images_are_normalized_into_pdf`
  (echter /stamps/image-Pfad, pikepdf: >=2 XObjects /Image mit Größe > 0 auf Seite 1, Seite 2
  bildfrei, Text heil). Pillow als Abhaengigkeit deklariert (requirements + PyInstaller-spec);
  gepacktes Backend enthaelt PIL (inkl. AVIF-Plugin) — verifiziert am gebauten Baum.

## Browser-E2E Runde 45 — Signatur live: letzte §3-Zeile durch die echte UI geschlossen
- `signaturePanel.spec.ts` (gruen): Zertifikat via pickCertDialog-Stub, Passwort, Describe
  (Panel-Gating), Signieren, Warten auf Backend-Signaturliste, Strg+S. Asserts auf der
  PLATTENDATEI (pymupdf als zweiter Parser): get_sigflags() signiert; /ByteRange deckt den
  Gesamtumfang (o1==0, o2+l2==len); MARK-S1/2 + 2 Seiten heil. TAMPER: Textanhang, Datei
  ueber echten `/document/open`+`/document/signatures`-Pfad neu bewertet -> nicht gueltig.
- Auf dem Weg bereinigte Test-eigene Irrtuemer (kein Produktbefund): pymupdf hat KEIN
  `Document.signatures` in dieser Version — korrekter Detektor ist `get_sigflags()` (wie im
  Backend-Test); Save-before-sign-Race behoben (erst Backend-Zustand abwarten);
  Zertifikate-Panel listet nur die Zeichenbibliothek, keine Dokument-Signaturen — die
  E2E wartet daher auf den echten Endpunkt, nicht auf ein nicht vorhandenes Panel-Element.
- Selbstsignierte Warn-Stacks von pyHanko im Backend-Log sind erwartet und dokumentiert
  (trusted=false, intact/valid=true — Integritaetsebene, nicht Trust-Trust).
- Damit hat JEDE §3-Feature-Zeile einen Live-UI-Nachweis. Suite 25/25 (~78 s).

## Browser-E2E Runde 44 — Verschlüsselung: toter Code -> echter, verifizierter Control
- §2-BEFUND (strukturell, ehrlich): documents.encryptDoc + Route /document/encrypt existierten
  samt Zweitbibliotheks-Test, aber es gab KEINEN Control — der Code war toter Bestand.
  §2.1 erlaubt fehlende Controls, verbietet aber still falsche Matix-Erwartungen; die
  Funktions-Zeile part-2-Umfangs war ohne Einstieg. NEU verdrahtet: Registry-Befehl
  file.encrypt (global, auch Native-Menue via commandCatalog), EncryptDialog (enc-user-pw/
  enc-owner-pw/enc-run, Warnung vor unwiederbringlichen Passwoertern), Einstieg ueber
  Eigenschaften-Panel (prop-encrypt) — UI zeigt damit nur noch, was wirkt, und die Funktion
  hat einen echten Nutzer-Einstieg.
- WICHTIGER Kontext fuer §3-Beweise: GET /document/file ist der ENTSCHLUESSELTE
  Rendering-Stream (pdf.js kann keine Krypto-Dateien) — Beweisdatei der Verschluesselung ist
  die per Speichern auf Platte geschriebene Datei, nicht der Viewer-Stream.
- `encryptDialog.spec.ts` (gruen, <1 s): Panel -> 'Verschluesseln' -> Passwort -> anwenden ->
  Strg+S. pikepdf/pymupdf auf der PLATTENDATEI: ohne Passwort PasswordError (CLOSED), mit
  Passwort offen, /CFM /AESV3 /Length 256 /R 6, 2 Seiten, MARK-E1/2 mit Passwort extrahierbar.
- Registry 53 Befehle, 244 UIDs; commandCatalog neu generiert (Native-Menue erhaelt den Punkt
  automatisch aus der Registry, keine Kopie).

## Browser-E2E Runde 43 — Formulare live (Fill liest sich zurueck; Flatten per UI)
- `formFillFlatten.spec.ts` (gruen, ~11 s): echtes Textfeld im Formular-Layer auszufuellen
  (blur-commit), pikepdf auf GET /document/file: /AcroForm /Fields==1, /V=='AUSGEFUELLT';
  dann pg-flatten->flatten-run per Klick: /Fields==0, AUSGEFUELLT weiterhin im extrahierten
  Seiteninhalt, FORMFIX des Fixtures erhalten (§3 beide Haelften: read-back + flattened).
- Suite 23/23 (~72 s). Keine Produktanderung noetig.

## Browser-E2E Runde 42 — Annotation live + DEF_FEKT behoben (Panel ohne erste Annotation)
- E2E-FANG 7 (real): das Annotationen-Panel verschluckte bei LEERER Annotationenliste die
  komplette Typ-/Platzier-Leiste (items.length===0 -> nur Hinweistext). Damit konnte die
  ERSTE Annotation nicht per Panel angelegt werden — der Einstez verschwindet genau dann,
  wenn er gebraucht wird. Fix: placeBar haengt an docOpen, nicht an items.length; beide
  Zweige rendern sie. Guard-Unit 'Platzier-Leiste bleibt auch ohne bestehende Annotationen'.
- `annotationNote.spec.ts` (gruen, 1.2 s): Panel->Typ Text->platzieren, echter Drag
  (80,200)->(300,260) auf Seite 1, Dialog mit Notiztext + Autor, anwenden. pikepdf auf
  GET /document/file: genau eine Nicht-Popup-Annotation /Subtype /Text auf Seite 1,
  Rect-Linkskante == Region-x und Rect-Oberkante == PDF-y der Regions-Unterkante je ±1 pt,
  /T == E2E-AUTOR, /Contents == E2E-NOTIZ, zugeordnetes /Popup-Kind vorhanden (korrekte
  PDF-Semantik, zaehlt nicht als Annotation), MARK-H1/2 bleiben extrahierbar, Seite 2 annotfrei.
- Lehrstueck falscher Kontrakt: Highlight-Rects snappen auf Glyph-Quads (pymupdf), FreeText
  skaliert sein Rect auf den Textumbruch — drag-exakt ist nur die Text-Notiz; dafuer ist der
  Rechteck-Kontrakt jetzt scharf bewiesen statt weich. Suite 22/22 (~66 s).

## Browser-E2E Runde 41 — Metadaten live + DEF_FEKT behoben (stiller Old-Wert-Save)
- E2E-FANG 6 (real, Nutzer-sichtbar): das Metadaten-Panel lud per GET nach dem Oeffnen;
  traf dieser Read NACH schnellen Nutzereingaben ein, ueberschrieb er das Formular mit den
  Alten Werten — der Speichern-Knopst schrieb dann STILL die alten Werte (Test initially
  1-von-3 flaky, DIAG: Backend 200 mit URSPRUNG nach Save). Fix MetadataPanel: editedRef-
  Guard — spaet eintreffende Reads duerfen frische Eingaben nicht ueberschreiben; Save-Click
  setzt den Guard zurueck (docVersion-Refetch waermt den Cache). Danach 5/5 stabil ~2 s.
- `metadataWrite.spec.ts` (gruen): Sidebar-Metadaten, Read-Pfad (URSPRUNG im Feld),
  Titel/Autor echt getippt, Speichern; pikepdf auf GET /document/file: NEUER-TITEL und
  NEUER-AUTOR lesbar, CREATOR-FIX und PRODUCER-FIX NICHT geloesscht (§3-Genauigkeit).
- Suite 21/21 (~66 s).

## Browser-E2E Runde 40 — Schwaerzung live + DEF_FEKT behoben (Kontextmenue ueber Viewport-Rand)
- E2E-FANG 5 (real): das Canvas-Kontextmenue (25+ Eintraege, ~1067 px hoch) wurde an den
  Klickpunkt geanchert OHNE Begrenzung — auf niedrigen Fenstern quoll der zerstoererische
  Unterbau (ts-redact u. a.) ueber die Unterkante und war mit der Maus unerreichbar
  (Playwright: "element is outside of the viewport"). Fix ContextMenu: Viewport-Clamping
  gegen die reale Menuegroesse + max-h-[calc(100vh-16px)] overflow-y-auto (scrollbar fuer
  sehr lange Menues).
- `redactSelection.spec.ts` (gruen, 0.9 s): Wort 'GEHEIM123' per echter Mausgeste in der
  Textebene selektiert, Rechtsklick -> ctx-ts-redact; pymupdf+pikepdf auf GET /document/file:
  'GEHEIM123' NICHT mehr extrahierbar (Kern-Assertion der §3-Zeile), 'SICHERTEXT' voll
  erhalten, Seitenzahl 1. Suite 20/20 (~66 s).

## Browser-E2E Runde 39 — Bildstempel live (Region + cm-Matrix ±1 pt)
- `imageStampRegion.spec.ts` (gruen, ~11 s): pg-stamp-image bewaffnet mit gestubbtem
  pickImage/readImageAsBase64 (80x40-PNG), echte Maus zieht Region CSS(100,250)->(180,290) auf
  Seite 1, stampimg-run bestaetigt. pikepdf auf GET /document/file: /Image-XObject mit Do genau
  auf Seite 1, Seite 2 bildfrei; cm-Matrix der Bildplatzierung erfuelle alle vier §3-Toleranzen
  von 1 pt (x, y-Unterkante in PDF-Orientierung, Breite, Hoehe gegen die umgerechnete Region).
- Suite 19/19 (~66 s). Damit sind BEIDE Stempel-Varianten (Text + Bild) inkl. Koordinaten durch
  die echte UI belegt.

## Browser-E2E Runde 38 — Facing-Paritaet live + DEF_FEKT behoben (horizontaler Balken in Doppelseite)
- E2E-FANG 4 (real, Electron-betreffend): In Doppelseiten-Moden rechnete Fit-Width/Fit-Page gegen
  die VOLLE Scrollarea-Breite; zwei nebeneinanderliegende Zellen erzwangen damit einen
  horizontalen Scrollbalken — Verstoess gegen §4 ("scrolls vertically only") und gegen die
  §7.4-Paritaetsregel. Fix in AppShell: fit-* rechnen in facing/facing-cover gegen box.w/2.
- `facingParity.spec.ts` (gruen): Mischgrößen-Fixture, Layout-Wechsel continuous->facing per
  echtem Select: kein horizontaler Scrollbalken, facing-Skala == continuous-Skala / 2
  (Regel-Paritaet der Doppelzelle), Reihenabstaende gleich 16–24, Zell-Container == Canvas-Box,
  Seitenlabel unter der Seite. Suite 18/18 (~54 s).

## Browser-E2E Runde 37 — Umsortieren per echtem Drag live
- `reorderDrag.spec.ts` (gruen, 0.6 s): HTML5-Drag mit echter Mausgeste von Thumbnail 1 auf die
  untere Haelfte von Thumbnail 3 (after-Semantik); pikepdf auf GET /document/file: MARK-
  Sequenz exakt [2,3,1,4], Seitenzahl 4 unveraendert. §3-Zeile "Reorder pages" damit durch
  echte UI inkl. Drop-Zonen-Semantik (after) belegt. Suite 17/17 (~53 s).

## Browser-E2E Runde 36 — Stempel-Koordinaten ±1 pt live + Suite-Races behoben
- `stampCoordinates.spec.ts` (gruen, ~11 s): pg-stamp bewaffnet das Werkzeug, echter
  Canvas-Klick (Playwright-Maus) auf CSS(100|250) relativ zur Seite 1, Dialog bestaetigt;
  pikepdf liest die Tm-Baselines der Arbeitskopie: ein Stempel-Treffer liegt auf der
  umgerechneten PDF-Position (x, 842-y) innerhalb der §3-Toleranz von 1 pt; Stempel nicht
  auf Seite 2; MARKs unveraendert. §3-Zeile "text stamp ... coordinates within 1 pt" damit
  durch echte UI belegt.
- Zwei Suite-Races repariert (nicht das Produkt): (1) Klickpunkt kann nach Lazy-Scroll unter
  dem TopBar landen -> erst scrollTop=0; (2) Toolbar vermisst sich nach Thumbnail-Mount neu
  und verschiebt Gruppen ins Overflow, waehrend ein als sichtbar erhaltener Inline-Klick
  laeuft -> Inline-Klick mit 3 s Timeout + Overflow-Fallback im Fehlerfall (4 Specs).
- Suite 16/16 (~52 s).

## Browser-E2E Runde 35 — Seitenzahlen live (mit Zähler-Semantik-Beweis)
- `pageNumbersRange.spec.ts` (gruen): echte UI NUMMERIERT Bereich 2-3 im Format SEITE{n};
  pikepdf auf GET /document/file: Nummern genau auf Seiten 2-3 (.SS.), keine auf 1/4, alle
  Original-MARKS erhalten. Belegt zusaetzlich die Daemm-Semantik aus §6: die ERSTE gewaehlte
  Seite traegt `start` (=1), die naechste 2 — Muster .12. Ein initially falscher
  Spec-Verdacht ("SEITE2/3 erwartet") stellte sich als korrekte dokumentierte Semantik
  heraus; Backend-Repro per Hand bestaetigte pikepdf-Sichtbarkeit beider Strings.
- Suite 15/15 (~41 s).

## Browser-E2E Runde 34 — Wasserzeichen live + Zoom-Anker live
- `watermarkRange.spec.ts` (gruen): echte UI setzt WASSERTEXT auf Bereich 2-3; pikepdf auf
  GET /document/file: Wasserzeichen-TF-Muster exakt FTTF (praesent im Bereich, abwesend
  ausserhalb), Seitenzahl 4 unveraendert, alle vier Original-MARKS noch im Textlayer.
- viewerLayout um §4-Zoom-Anker erweitert: Viewport-Mitte vor tb-zoom-in gemerkt (Seite +
  Seitenanteil), nach Zoom identische Seite und Anteil innerhalb 5 Prozentpunkte — Anker
  haelt, kein Reset nach oben. Suite 14/14 (~30 s).

## Browser-E2E Runde 33 — Insert-Index live + Suite-Robustheit
- `insertAtIndex.spec.ts` (gruen, 0.7 s): echte UI fuegt leere Seite VOR Seite 2 ein; pikepdf
  auf der ueber GET /document/file geladenen Arbeitskopie: 4 Seiten, Markierungssequenz
  [1,0,2,3] — leere Seite am gewuenschten Index (nicht am Ende), Nachbarseiten behalten ihre
  Texte. §3-Zeile "Insert pages" damit durch echte UI belegt.
- Flankierend: Extract- und Insert-Specs warten jetzt per waitFor(visible) auf den
  Sidebar-Toolbar-Mount (Sofort-isVisible war eine Rennen-Quelle; pg-insert ist inline, die
  Overflow-Pfade bleiben als echter Nutzerzustand erhalten). Suite 12/12 (~18 s).

## Browser-E2E Runde 32 — Split-Live + §4-Round-Trip
- `splitOrder.spec.ts` (gruen, 0.8 s): echte Toolbar-/Overflow-UI teilt 4-Seiten-Fixture alle 2
  Seiten → genau 2 Dateien im Zielordner; pikepdf: Seitenzahlen summieren auf 4, in Datei-
  Sortierung aneinandergereiht exakt MARK-S1..4 (Originalreihenfolge), Quelldatei SHA-256
  unveraendert. Suite 11/11.
- viewerLayout erweitert um letzte §4-Bedingung: nach Sprung ans Ende und zurueck nach 0 sind
  Scroll-Offset (0) und Slot-Offsets identisch zum Ausgangszustand (Layout-Stabilitaet gegen
  Lazy-Shift) — in allen 6 Groessen/dpr-Kombinationen gruen.

## Browser-E2E Runde 31 — §4-Akzeptanz in ECHEM Chromium (6/6) + Fit-Clamp-Defekt behoben
- `viewerLayout.spec.ts`: Mischgrößen-Fixture (A4 hoch/quer, A3, /Rotate-90-Seite) bei
  400/800/1600 px × dpr 1/2, gemessen im Browser: breiteste Seite == Scrollarea-Breite minus
  Padding (±2px), KEIN horizontaler Scrollbalken, schmalere Seiten bleiben proportional kleiner
  (Ratio > 1,3, nicht gestreckt), alle Lücken identisch in 16–24, Container == Canvas-CSS-Box,
  Backingstore == CSS × dpr, Spaltenhöhe == letzte Slot-Unterkante (Scroll-Höhe summet über
  echte Platzhalter-Maße), Seiten-Sprung auf Seitenspitze (mit redlicher Klemme an
  maxScroll bei kurzem Inhalt).
- **E2E-FANG 2 (real):** Fit-Width/Fit-Page waren an `clampZoom` (min 0,1) gelegt — bei
  schmalen Fenstern erzeugte das einen horizontalen Scrollbalken (400px: alle dpr rot).
  Fix: Fit-Modi nutzen die Roh-Skala (clampZoom gilt nur noch für Benutzer-Zoom); nach Fix
  alle 6 Kombinationen grün. Suite jetzt 10/10 (~15 s).
- Erkenntnis notiert: am Dokumentende meldet der Scroll-Spy Seite 3 (größter Flächenanteil) —
  Eingabe derselben Seite ist store-seitig No-op und löst bewusst KEINEN Sprung aus
  (spy-getriebene Änderungen springen nicht zurück); der E2E navigiert deshalb auf eine
  andere Seite.

## Browser-E2E Runde 30 — Extract + Delete (Zeilen §3 abgedeckt)
- `extractUnchanged.spec.ts`: echter Pfad pg-extract (_overflow-Fallback: bei echter Chromium-Breite
  landete die Gruppe im Overflow-Menü — Spec folgt beiden Wegen_) -> ExtractDialog(2, Zielverzeichnis
  via chooseDirectory-Stub) -> Ergebnis auf Platte: genau 1 Seite, nur MARK-P2; Quelldatei
  SHA-256-byte-identisch. `deletePage.spec.ts`: Seitensprung via tb-page-input, pg-del -> pikepdf am
  Arbeitsstand: 2 Seiten, MARK-P2 nirgends, MARK-P1 vor MARK-P3. Suite jetzt 4/4 (4,5 s).

## Browser-E2E Runde 29 — Append/Merge + echtes State-Update
- **Append per echtem UI:** `tests/e2e/browser/appendMerge.spec.ts` klickt `sidebar-append`
  (-> `/pages/merge`), Beweis auf der Platte mit pikepdf: 4 Seiten, letzte zwei tragen
  B1MARK/B2MARK (rekursiv aus Content-Stream-Operanden inkl. Array-`[<hex>]TJ`), Zielseiten
  unveraendert, Gliederung enthaelt QUELL- UND ZIEL-Kapitel. (Erster Lauf traf versehentlich
  das Ende-Einfuegen statt Merge — Zielkorrektur dokumentiert.)
- **E2E-FANG, echter App-Defekt:** `/document/state` lieferte kein `pageCount`; der Toolbar
  zeigte nach JEDER Seiten-Mutation die alte Zahl (betrifft Electron ebenso). Fix:
  `session.state()` meldet `pageCount`; `applyDocumentState` setzt + klemmt `currentPage`;
  Backend-Beweis `test_pages_ops.py::test_document_state_reports_page_count_after_insert`
  (3 -> einfügen -> 4), der ohne Fix rot war. Spec prueft zusaetzlich die State-Antwort.

- **Lauffähig ohne Electron:** `npm run test:e2e:browser` startet das ECHTE Python-Backend
  (globalSetup, Port 0) + echten Renderer via Vite (`scripts/vite.e2e.config.ts`) gegen
  headless Chromium; nur die native IPC-Schicht ist gestubbted (`tests/e2e/browser/bridge.ts`).
  Beweis `tests/e2e/browser/rotateUndo.spec.ts`: Klick auf `tb-open` (echter Knopf, Dialog gibt
  Fixture-Pfad), Klick auf `pg-rot-right`, dann GEGENPRÜFUNG mit pikepdf (zweite Bibliothek) am
  Arbeitsstand über denselben `/document/file`-Endpunkt wie die UI: `3 90 0` (Seitenzahl +
  Rotation Seite 1/2). Danach Klick auf `tb-undo` -> SHA-256 des Arbeitsstands byte-identisch
  zum Vorher-Bild. Fund beim ersten Lauf: Fixture wurde wegen eines überzähligen argv-Arguments
  nach `x` geschrieben (Backend: "Datei nicht gefunden") — guard-wirksam korrigiert.
## Command-Registry (PART 3 §7.6) + Toolbar (PART 3 §7.5) — Status
- **§5-Layout DOM-geprüft (Runde 27):** `pagesToolbar.test.tsx` beweist `flex-nowrap`, genau
  n−1 sichtbare Trennlinien bei n Inline-Gruppen, Lücke + Warnfarbe vor `pg-del` und dass 180°
  ein Icon ohne Text ist; `pagesToolbarRegistry.test.tsx` verschärft: Tooltip jedes Knopfes mit
  Shortcut enthält dessen formatierten Text aus der EINEN `SHORTCUTS`-Tabelle.
- **Menü-Bar aus der Registry (§6) + Default-Menü-Datenverlust behoben (Runde 26):** Es gab KEIN
  `setApplicationMenu` — Electrons Standard-Menü lief mit, d. h. **Strg+W schloss das Fenster und
  Strg+R lud stumm neu (Session/ungespeicherte Änderungen verloren)** und die Bar war eine
  Aktions-Kopie außerhalb der Registry. Jetzt: `src/main/menuModel.ts` (elektron-frei, getestet)
  baut die Bar aus dem generierten Katalog `src/shared/commandCatalog.gen.ts`
  (`scripts/command-catalog.mjs`); Frische erzwingt `tests/shared/commandCatalog.test.ts`
  (Byte-Vergleich). Klick sendet nur die id via `menu:command` (preload `onMenuCommand`,
  AppShell-Abonnement) → `dispatchCommand(id)` mit demselben Gate wie Tastatur/Kontextmenü.
  Edit-Rolle = reine Clipboard-Helfer, kein Reload/Close mehr. Beweise:
  `tests/main/menuModel.test.ts` (jede Katalog-Zeile genau einmal, Klick→id, Sortierung, leere
  Bars weg), Frische-Test, `commands.test.ts` dispatchCommand (No-Op bei unbekannter id, Gate
  ohne Dokument, globale id wirkt auf echten Store). Electron-Laufzeitverhalten bleibt gated
  (Display/Binary), Modell + Dispatcher sind vollständig unit-getestet.
- **§6-Erreichbarkeits-Guard (Runde 25):** `commands.test.ts` beweist maschinell
  `Toolbar-Ids ⊆ Thumbnail-Menü ∪ Canvas-Menü` (volles, editierbares Dokument). Erster Lauf fand
  vier unerreichbare Toolbar-Aktionen (`pg.stampImage`, `pg.images`, `pg.export`, `pg.selectAll`)
  — alle in beide Menüs aufgenommen. `pg.clear` (destruktiv, nur Auswahl) steht im destruktiven
  Block **vor** `pg.delete`: die letzte Position gehört dem echten Löschen (Destruktiv-Ordnung in
  `commands.test` + `textSelectionCommands` + delete-last-Journey festgezogen).
**Eine Quelle:** `src/renderer/lib/commands.ts` definiert jede Aktion genau einmal (id, labelKey,
Icon, Gruppe, Reihenfolge, `destructive`, `testid`, `isEnabled(ctx)`, `run(ctx)`). `tests/renderer/
commands.test.ts` erzwingt die PART-3-Invarianten:
- ids + testids eindeutig; jeder `shortcutId` existiert in `SHORTCUTS` (kein Drift); **jeder Handler
  echt, kein Stub** (§2: keine tote Kontrolle); `destructive` nur bei `pg.delete`.
- **§6 Kontextmenü:** `contextMenuFor` lässt nicht zutreffende Einträge WEG (nicht ausgegraut);
  zerstörerisches zuletzt/getrennt. **§5 Toolbar:** `TOOLBAR_GROUPS` feste Reihenfolge.
- **Toolbar rendert aus der Registry:** `PagesToolbar` baut seine Gruppen aus `COMMANDS`; der
  Read-only/Lock-Zustand deaktiviert (sichtbar), weil das eine gültige, gerade nicht ausführbare
  Aktion ist (keine tote Kontrolle). `flex-wrap` → `flex-nowrap` (kein Umbruch in mehrere Zeilen).
- **Beweis:** `commands.test.ts` (12) + `pagesToolbarRegistry.test.tsx` (3: DOM-Reihenfolge folgt
  §5; Löschen mit Vor-Abstand; ohne Dokument keine Dokument-Aktionen) + bestehende
  `pagesToolbar.test.tsx` ( Verhalten, Read-only-deaktiviert ) grün. Renderer **387**, tsc web/node OK.
- **Kontextmenü (§6):** `ContextMenu.tsx` rendert aus `contextMenuFor` (omit-not-grey, Shortcut
  rechtsbündig, zerstörerisches unten nach Separator, Scope-Header, Tastatur Pfeile/Enter/Esc,
  Outside-Click). **Thumbnail- UND Canvas-Ziel verdrahtet + über echten Rechtsklick verifiziert**:
  Thumbnail (`tests/renderer/thumbnailContextMenu.test.tsx`) und Canvas
  (`tests/renderer/viewerContextMenu.test.tsx`: Scope = Rechtsklickseite `expr:'4'` trotz
  currentPage 1; Auswahl-Scope `expr:'2-3'`; Seiten-Ops vor Ansicht; `view.fitWidth` setzt echten
  Store) — jeweils bis zum echten Endpunkt/Store nachgewiesen, nicht nur Handler-Aufruf.
  Diagramme + Aktionstabelle: `docs/ui/context-menu.md`. **Annotations-Ziel (Runde 11):**
  `contextMenuFor('annotation')` = `ann.edit` (öffnet Editor via `setSelectedAnnotationId`) +
  `ann.delete` (`documents.deleteAnnotation`), verdrahtet an den Zeilen der
  `AnnotationListPanel`; bewiesen in `tests/renderer/annotationContextMenu.test.tsx` (6).
  **Textauswahl-Ziel (Runde 15):** echter Auswahl-Fänger in `PageCanvas` (dieselbe
  Viewport-Naht wie der Overlay-Drag -> `convertToPdfPoint`, Zoom/DPR/Rotation herausgerechnet),
  Auswahl fließt `PageCanvas -> AppShell -> ViewerContextMenu -> contextMenuFor('canvas')`.
  Neue Registry-Befehle `ts.copy` (Clipboard-API), `ts.highlight/underline/strikeout`
  (`documents.addAnnotation`, §3-Endpunkt), `ts.redact` (destruktiv; `documents.applyRedaction`
  — ERSTER UI-Aufrufer des in §3 dual-verifizierten Schwärz-Endpunkts), `ts.askAi`
  (AI-Tab + `useAiStore.ask` mit Zitat). **Beweis:** `textSelectionCommands.test.ts` (8:
  ts.-Einträge VOR Seiten-Ops, ohne Auswahl fortgelassen, readOnly lässt nur Kopieren/KI,
  `addAnnotation({page0:4,type:'Highlight',...})`, `applyRedaction([{page:5,...}])` 1-basiert,
  echte KI-Frage mit Auswahltext) + `pageCanvasSelection.test.tsx` (3: Seite 3 meldet
  `rect{10,480,100,20}` mit y-Inversion, collapsed -> null, fremde Seite meldet nicht).
  „Antworten" auf Annotationen und Stempel-„Anwenden" bleiben proposed (kein direkter Handler).
- **§5 Überlauf-Modell (`toolbarOverflow.ts` + `pages-more`):** Zeile bricht nie um (`flex-nowrap`,
  kein Scroll mehr); passt eine Gruppe nicht komplett, zieht sie VOLLSTÄNDIG in den ⋯-Knopf, der
  dasselbe getestete `ContextMenu` nutzt (Header unterdrückt, zerstörerische unten). 180° ist ein
  Icon (Text nur im Tooltip), Löschen mit Abstand. **Beweis:** `toolbarOverflow.test.ts` (9: exakte
  Passung/Reservierung/Ganztakt-Gruppen/Reihenfolge/Metrik) + `pagesToolbarOverflow.test.tsx`
  (3 am echten Bauteil mit ResizeObserver-Fake: breit→kein ⋯; schmal→hintere Gruppen vollständig
  im ⋯; ⋯-Menü führt echten Store-Aufruf aus; sehr schmal→alles im ⋯, nichts abgeschnitten).
  Textauswahl-/Annotations-Einträge + Annotations-/Stempel-Rechtsklick (werden erst mit echten
- **Menü-Bar + globale Shortcuts aus der Registry (§7.6, Runde 12):** AppShell-Keydown ist nur noch
  `matchShortcut + dispatchShortcut` (keine lokale Aktions-Tabelle), FileMenu ruft `file.*`-Befehle
  (`runCmd`/`cmdOff`). **Beweis:** `globalCommands.test.ts` (5: alle 17 Shortcut-ids haben genau
  EINEN Befehl; `dispatchShortcut('settings'|'shortcuts'|'debug')` kippt echte Stores; Zoom nur mit
  Dokument; `saveDocument('save')` via Spy nur wenn `docOpen`; undo-Pforte über `canUndo`) und —
  independent — das UNVERÄNDERT grüne `fileMenu.test.tsx` (Speichern-Modi + Deaktivierung laufen
  jetzt durch die Registry). Zoom-Befehle sind identisch mit den Canvas-Menü-Einträgen (`view.*`).
- **Noch offen (§7.5/§7.6):** Textauswahl-/Annotations-Einträge + Annotations-/Stempel-Rechtsklick
  (werden erst mit echten
  Handlern angelegt, §2); `runCommand`-Dispatch + Menü-/Shortcut-Flächen vollständig auf die Registry.

## Viewer-Layout (PART 3 §7.4) — Status
Geometrie-Quelle `src/renderer/lib/viewerLayout.ts` (rein, getestet); DOM via `PageColumn.tsx`.
- **Behoben & bewiesen (vitest):** Fit-Width = **breiteste** Seite; Slot == reale Seitengröße (kein
  größerer Wrapper); nicht sichtbare Seiten = Platzhalter **realer** `getViewport`-Größe
  (`useAllPageSizes`) → exakte Gesamt-Scrollhöhe & korrekte Sprünge; Seitenlabels; Auswahl-Rahmen auf
  dem seitengroßen Slot (`viewerLayout.test.ts` + `pageColumn.test.tsx`).
- **Zoom-Anker (§4) — Modell bewiesen, verdrahtet:** `anchorScrollForZoom` hält den Viewport-Mittelpunkt
  (Identität bei gleichem Zoom + Anker-Seite/-Bruch bleibt + Klemmung); `viewerLayout.test.ts`
  `describe('anchorScrollForZoom')`. In `AppShell` per Scale-Effect verdrahtet.
- **Aktuelle-Seite per Viewport-Anteil + Seitenzahl-Sprung (§4) — Modell bewiesen, verdrahtet:**
  `pageWithLargestShare` + `pageTopScroll` (Seite p → `offsets[p-1]`, geklemmt); in `AppShell` als
  Scroll-Spy + Seitenzahl-Navigation (mit Spy-/Nav-Lock gegen Rück-Sprung) verdrahtet.
- **Backing-Store vs. CSS (§4) — jetzt BEWIESEN (Runde 21):** `pageRenderDpr.test.tsx` (4) fährt
  den echten Hook mit dpr 1/2 und Zoom: Backing == `floor(viewport·dpr)`, CSS bleibt logisch,
  Render-Transform == `[dpr,0,0,dpr,0,0]`, Viewport selbst dpr-frei. `Akzeptanz-Sweep` in
  `viewerLayout.test.ts`: Fensterbreiten **400/800/1600** (Gutter 48 abgezogen) je mit allen
  Invarianten (breiteste füllt ±2, kein Overflow ⇒ keine H-Scrollbar, Slot==Seite, gleiche Lücken,
  Gesamtsumme ±2); dpr geht in kein Layout-Modell (logische Pixel).
- **Doppelseiten-Parität (§7.4) — Modell + DOM bewiesen (Runde 13):** Der alte Zeilenpfad ist
  entfernt; `facing`/`facing-cover` rendern jetzt `FacingColumn.tsx` über dasselbe
  Reale-Maße-Modell wie Einspaltig (`buildFacingColumn`: Slot == `viewport*scale`, Zeilenhöhe =
  max der Seiten, gleiche Lücken, `center±2`-Render-Fenster, Platzhalter realer Größe,
  center-unabhängige Offsets -> stabile Scrollhöhe). Beweise: `facingLayout.test.ts` (4: Höhe=max,
  Offsets kumulativ + center-unabhängig, totalHeight=Σmax+Lücken, Render-Fenster/Containment,
  Einzelzelle bei ungerader letzten Seite -> [5]) und `facingColumn.test.tsx` (3: Slot 200×400/120×240 px,
  Label unter jeder Seite, Rahmen nur auf aktueller Seite, Seite 4 Platzhalter in echter Größe).
- **Noch offen (Gated, nicht Blocker):** **Playwright-DOM-Geometrie-/E2E-Test**
  (mischt A4 P/L, A3, rot 90° bei 400/800/1600 px, dpr 1/2) — braucht gebautes Electron-Binary +
  Display (wie `tests/e2e/smoke.spec.ts` gated; hier weder X-Server noch Electron-Binary). Modell +
  DOM-Verdrahtung sind tsc- + suite-grün; der interaktive Pixel-Beweis steht mit diesem Test aus.
