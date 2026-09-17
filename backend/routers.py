"""HTTP-Router fuer Step 3: Dokument, Seiten, Metadaten, Verschlüsselung, Undo/Redo.

Alle Mutationen laufen serialisiert über den Mutation-Lock der Session (Spec Section 3:
zwei gleichzeitige Schreiben auf dieselbe Arbeitskopie würden Datei + Undo-Stapel zerstören).
Blockierende PDF-Arbeit läuft im Threadpool, damit der Event-Loop frei bleibt.
Responses nach aussen camelCase; Fehler sind pdflib.PdfError-Subklassen (Handler in main.py).
"""
from __future__ import annotations

import base64
import os

from fastapi import APIRouter, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from backend import annotation_ops, crypto_ops, export_ops, form_ops, image_ops, outline_ops, pdflib, pkcs11_ops, properties_ops, redact_ops, security_ops, sig_lib, stamp_ops, trust_ops
from backend.session import DocumentSession
from backend.schemas import (
    VerifyPinRequest,
    CertDescribeRequest,
    LineariseRequest,
    CompressRequest,
    DeletePagesRequest,
    DecryptRequest,
    DeleteRequest,
    DuplicatePagesRequest,
    EncryptRequest,
    ExportImagesRequest,
    ExportTextRequest,
    ExtractImagesRequest,
    ExtractPagesRequest,
    FlattenRequest,
    ImageStampSelectionRequest,
    InsertPagesRequest,
    ImagesToPdfRequest,
    MergeRequest,
    MetadataRequest,
    OpenRequest,
    PageNumbersRequest,
    PropertiesRequest,
    RedactRequest,
    ReorderRequest,
    RotatePagesRequest,
    RotateRequest,
    SaveRequest,
    SignRequest,
    SigImportFileRequest,
    SigImportRequest,
    TrustImportRequest,
    SigTextRequest,
    SplitDocumentRequest,
    StampRequest,
    TextStampRequest,
    WatermarkRequest,
    RemoveAnnotationsRequest,
    AddAnnotationRequest,
    FillFormRequest,
    ResetFormRequest,
    EditAnnotationRequest,
    DeleteAnnotationRequest,
    ImageObjectUpdateRequest,
    ImageObjectDeleteRequest,
    FsExistsRequest,
    SignPkcs11Request,
)

router = APIRouter()


def _session(request: Request) -> DocumentSession:
    return request.app.state.session


def _require(session: DocumentSession) -> None:
    if not session.is_open:
        raise pdflib.NoDocument("Kein Dokument geöffnet")


def _require_writable(session: DocumentSession) -> None:
    _require(session)
    if session.read_only:
        raise pdflib.ReadOnly("Dokument ist schreibgeschützt (nur Benutzer-Passwort)")


# ---------------------------------------------------------------- Dokument
@router.post("/document/open")
async def open_document(body: OpenRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        info = await run_in_threadpool(pdflib.open_into_work, body.path, body.password, session.work_path)
        session.open_document(body.path, info.read_only, info.encrypted, body.password)
    return {
        "pageCount": info.page_count,
        "width": info.width,
        "height": info.height,
        "rotation": info.rotation,
        "encrypted": info.encrypted,
        "readOnly": info.read_only,
    }


@router.get("/document/state")
async def document_state(request: Request) -> dict:
    return _session(request).state()


@router.get("/document/pages")
async def document_pages(request: Request) -> dict:
    session = _session(request)
    _require(session)
    pages = await run_in_threadpool(pdflib.page_sizes, session.work_path)
    return {"pages": pages}


@router.get("/document/file")
async def document_file(request: Request) -> Response:
    # Rohe Bytes der Arbeitskopie fuer den pdfjs-Renderer (der Renderer hat keinen fs-Zugriff,
    # Section 2). Token-geschuetzt wie alles ausser /health. no-store: nach einer Mutation muss
    # der naechste Ladezyklus die aktuellen Inhalte sehen — pdfjs cacht sonst den Buffer.
    session = _session(request)
    _require(session)

    def _read() -> bytes:
        with open(session.work_path, "rb") as fh:
            return fh.read()

    data = await run_in_threadpool(_read)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Cache-Control": "no-store", "Content-Disposition": "inline; filename=work.pdf"},
    )


# ---------------------------------------------------------------- Metadaten
@router.get("/document/metadata")
async def get_metadata(request: Request) -> dict:
    session = _session(request)
    _require(session)
    return await run_in_threadpool(pdflib.get_metadata, session.work_path)


@router.get("/document/outline")
async def document_outline(request: Request) -> dict:
    # Read-only (Section 5): bestehende Gliederung anzeigen; Bearbeiten ist V1.1.
    session = _session(request)
    _require(session)
    return await run_in_threadpool(outline_ops.get_outline, session.work_path)


@router.get("/document/annotations")
async def document_annotations(request: Request) -> dict:
    # Read-only: bestehende Annotationen fuer die Liste (Section 8).
    session = _session(request)
    _require(session)
    return await run_in_threadpool(annotation_ops.list_annotations, session.work_path)


@router.post("/document/remove-annotations")
async def remove_annotations_route(body: RemoveAnnotationsRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("REMOVE_ANNOTATIONS")
        try:
            res = await run_in_threadpool(annotation_ops.remove_annotations, session.work_path, body.expr)
        except (pdflib.PdfError, annotation_ops.AnnotationError):
            session.after_failed_mutation()
            raise
    return res


@router.get("/document/form-fields")
async def form_fields_route(request: Request) -> dict:
    session = _session(request)
    _require(session)
    return await run_in_threadpool(form_ops.list_form_fields, session.work_path)


@router.post("/document/fill-form")
async def fill_form_route(body: FillFormRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("FILL_FORM")
        try:
            res = await run_in_threadpool(form_ops.set_field_value, session.work_path, body.name, body.value)
        except (pdflib.PdfError, form_ops.FormError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/document/reset-form")
async def reset_form_route(body: ResetFormRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("RESET_FORM")
        try:
            res = await run_in_threadpool(form_ops.reset_form, session.work_path, body.names)
        except (pdflib.PdfError, form_ops.FormError):
            session.after_failed_mutation()
            raise
    return res


@router.get("/document/annotation")
async def annotation_detail_route(id: str, request: Request) -> dict:
    session = _session(request)
    _require(session)
    return await run_in_threadpool(annotation_ops.get_annotation, session.work_path, id)


@router.post("/document/edit-annotations")
async def edit_annotation_route(body: EditAnnotationRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("EDIT_ANNOTATION")
        try:
            res = await run_in_threadpool(
                annotation_ops.edit_annotation, session.work_path, body.id,
                text=body.text, author=body.author, color=body.color, opacity=body.opacity, rect=body.rect,
            )
        except (pdflib.PdfError, annotation_ops.AnnotationError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/document/delete-annotation")
async def delete_annotation_route(body: DeleteAnnotationRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("DELETE_ANNOTATION")
        try:
            res = await run_in_threadpool(annotation_ops.delete_annotation, session.work_path, body.id)
        except (pdflib.PdfError, annotation_ops.AnnotationError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/document/add-annotations")
async def add_annotation_route(body: AddAnnotationRequest, request: Request) -> dict:
    session = _session(request)
    rect = {"x": body.x, "y": body.y, "width": body.width, "height": body.height}
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("ADD_ANNOTATION")
        try:
            res = await run_in_threadpool(
                annotation_ops.add_annotation, session.work_path,
                page=body.page, annot_type=body.type, rect=rect, text=body.text,
                color=body.color, opacity=body.opacity, author=body.author, fontsize=body.fontsize,
            )
        except (pdflib.PdfError, annotation_ops.AnnotationError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/document/metadata")
async def set_metadata(body: MetadataRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("SET_METADATA")
        try:
            res = await run_in_threadpool(
                pdflib.set_metadata, session.work_path, body.title, body.author, body.subject, body.keywords
            )
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return res


# ---------------------------------------------------------------- Seiten
@router.post("/pages/rotate")
async def rotate_page(body: RotateRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("ROTATE_PAGE")
        try:
            res = await run_in_threadpool(pdflib.rotate_page, session.work_path, body.page, body.delta)
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return res


@router.post("/pages/delete")
async def delete_page(body: DeleteRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("DELETE_PAGE")
        try:
            res = await run_in_threadpool(pdflib.delete_page, session.work_path, body.page)
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return {"pageCount": res["page_count"]}


@router.post("/pages/reorder")
async def reorder_pages(body: ReorderRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("REORDER_PAGES")
        try:
            res = await run_in_threadpool(pdflib.reorder_pages, session.work_path, body.order)
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return {"pageCount": res["page_count"]}


@router.post("/pages/merge")
async def merge_pdf(body: MergeRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("MERGE_PDF")
        try:
            res = await run_in_threadpool(pdflib.merge_pdf, session.work_path, body.path)
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return {"pageCount": res["page_count"], "added": res["added"]}


# ------------------------------------------------ Seitenverwaltung: Auswahl (Section 6)
def _default_base(session: DocumentSession) -> str:
    src = session.original_path or "document"
    return os.path.splitext(os.path.basename(src))[0] or "document"


@router.post("/pages/rotate-selection")
async def rotate_pages(body: RotatePagesRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("ROTATE_PAGES")
        try:
            res = await run_in_threadpool(pdflib.rotate_pages, session.work_path, body.expr, body.delta)
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return res


@router.post("/pages/delete-selection")
async def delete_pages(body: DeletePagesRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("DELETE_PAGES")
        try:
            res = await run_in_threadpool(pdflib.delete_pages, session.work_path, body.expr)
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return res


@router.post("/pages/duplicate")
async def duplicate_pages(body: DuplicatePagesRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("DUPLICATE_PAGES")
        try:
            res = await run_in_threadpool(
                pdflib.duplicate_pages, session.work_path, body.expr, body.position, body.page
            )
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return res


@router.post("/pages/extract")
async def extract_pages(body: ExtractPagesRequest, request: Request) -> dict:
    # Quelle bleibt unveraendert -> KEIN Command / keine Mutation. Auch bei schreibgeschuetztem
    # Dokument erlaubt (die interne Arbeitskopie ist entschluesselt).
    session = _session(request)
    _require(session)
    base = body.baseName or _default_base(session)
    return await run_in_threadpool(
        pdflib.extract_pages, session.work_path, body.expr, body.destDir, body.each, base
    )


@router.post("/pages/split")
async def split_document(body: SplitDocumentRequest, request: Request) -> dict:
    # Erzeugt neue Dateien, Quelle unveraendert -> kein Command.
    session = _session(request)
    _require(session)
    base = body.baseName or _default_base(session)
    return await run_in_threadpool(
        pdflib.split_document, session.work_path, body.mode, body.page, body.count, body.points, body.destDir, base
    )


@router.post("/pages/insert")
async def insert_pages(body: InsertPagesRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("INSERT_PAGES")
        try:
            res = await run_in_threadpool(
                pdflib.insert_pages, session.work_path, body.position, body.page, body.source.model_dump()
            )
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return res


@router.post("/fs/exists")
async def fs_exists(body: FsExistsRequest, request: Request) -> dict:
    _session(request)  # nur mit gueltiger Session befragbar
    try:
        return {"exists": os.path.isfile(body.path)}
    except Exception:
        return {"exists": False}


# ------------------------------------------------ Bild-/Grafik-Objekte nachtraglich bearbeiten
@router.get("/signature-graphic")
async def signature_graphic(path: str = Query(...)) -> dict:
    # R60: eigene Grafik fuer das Signaturfeld (z.B. Unterschrift als PNG/JPG).
    # Laedt die Datei (Pfad aus dem nativen Oeffnen-Dialog) und liefert base64.
    from backend.image_ops import read_graphic_file
    return await run_in_threadpool(read_graphic_file, path)


@router.get("/document/image-objects")
async def image_objects_route(request: Request, expr: str = Query("all")) -> dict:
    session = _session(request)
    return await run_in_threadpool(image_ops.list_image_objects, session.work_path, expr)


@router.post("/images/object/update")
async def image_object_update(body: ImageObjectUpdateRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("IMAGE_OBJECT")
        try:
            res = await run_in_threadpool(
                image_ops.update_image_object, session.work_path, body.page,
                body.bbox.model_dump(), body.rect.model_dump(), body.rotateDelta)
            return res
        except image_ops.ImageObjectError:
            session.after_failed_mutation()
            raise
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise


@router.post("/images/object/delete")
async def image_object_delete(body: ImageObjectDeleteRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("IMAGE_OBJECT_DELETE")
        try:
            res = await run_in_threadpool(
                image_ops.delete_image_object, session.work_path, body.page, body.bbox.model_dump())
            return res
        except image_ops.ImageObjectError:
            session.after_failed_mutation()
            raise
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise


# ------------------------------------------------ Stempel / Seitenzahlen (Section 7)
@router.post("/stamps/image")
async def stamp_image_selection(body: ImageStampSelectionRequest, request: Request) -> dict:
    session = _session(request)
    try:
        image_bytes = base64.b64decode(body.image, validate=True)
    except Exception:
        raise stamp_ops.StampError("Bild ist kein gueltiges Base64") from None
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("STAMP_IMAGE")
        try:
            res = await run_in_threadpool(
                stamp_ops.stamp_image_selection, session.work_path, body.expr,
                {"x": body.x, "y": body.y, "width": body.width, "height": body.height},
                image_bytes, body.opacity, body.rotation, body.overlay, body.keepProportion,
            )
        except (pdflib.PdfError, stamp_ops.StampError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/stamps/text")
async def stamp_text_route(body: TextStampRequest, request: Request) -> dict:
    session = _session(request)
    filename = os.path.splitext(os.path.basename(session.original_path or ""))[0]
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("STAMP_TEXT")
        try:
            res = await run_in_threadpool(
                stamp_ops.stamp_text, session.work_path, body.expr, body.x, body.y, body.text,
                body.fontname, body.fontsize, body.color, body.opacity, body.rotation, body.align,
                body.overlay, filename,
            )
        except (pdflib.PdfError, stamp_ops.StampError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/stamps/page-numbers")
async def page_numbers_route(body: PageNumbersRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("PAGE_NUMBERS")
        try:
            res = await run_in_threadpool(
                stamp_ops.add_page_numbers, session.work_path, body.expr, body.position,
                body.margin, body.format, body.start, body.fontname, body.fontsize, body.color,
            )
        except (pdflib.PdfError, stamp_ops.StampError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/stamps/watermark")
async def watermark_route(body: WatermarkRequest, request: Request) -> dict:
    session = _session(request)
    filename = os.path.splitext(os.path.basename(session.original_path or ""))[0]
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("WATERMARK")
        try:
            if body.kind == "text":
                res = await run_in_threadpool(
                    stamp_ops.add_watermark_text, session.work_path, body.expr, body.text or "",
                    body.angle, body.opacity, body.fontname, body.fontsize, body.color,
                    body.tiled, body.overlay, filename,
                )
            elif body.kind == "image":
                if not body.image:
                    raise stamp_ops.StampError("Bild-Wasserzeichen benoetigt ein Bild")
                image_bytes = base64.b64decode(body.image, validate=True)
                res = await run_in_threadpool(
                    stamp_ops.add_watermark_image, session.work_path, body.expr,
                    {"x": body.x, "y": body.y, "width": body.width, "height": body.height},
                    image_bytes, body.opacity, body.angle, body.tiled, body.overlay, True,
                )
            else:
                raise stamp_ops.StampError(f"Unbekannter Wasserzeichen-Typ '{body.kind}'")
        except (pdflib.PdfError, stamp_ops.StampError):
            session.after_failed_mutation()
            raise
    return res


@router.get("/document/images")
async def list_images_route(request: Request, expr: str = Query("all")) -> dict:
    session = _session(request)
    _require(session)
    return await run_in_threadpool(stamp_ops.list_images, session.work_path, expr)


@router.post("/document/extract-images")
async def extract_images_route(body: ExtractImagesRequest, request: Request) -> dict:
    # Erzeugt neue Dateien, Quelle unveraendert -> kein Command.
    session = _session(request)
    _require(session)
    base = body.baseName or _default_base(session)
    return await run_in_threadpool(stamp_ops.extract_images, session.work_path, body.expr, body.destDir, base)


# ------------------------------------------------ Roteierung (Section 10, irreversibel)
@router.post("/redaction/preview")
async def redaction_preview(body: RedactRequest, request: Request) -> dict:
    # Nicht-mutierend, auch im Read-only-Modus erlaubt: zeigt betroffene Strings.
    session = _session(request)
    _require(session)
    regions = [r.model_dump() for r in body.regions]
    return await run_in_threadpool(redact_ops.preview_redaction, session.work_path, regions)


@router.post("/redaction/apply")
async def redaction_apply(body: RedactRequest, request: Request) -> dict:
    session = _session(request)
    regions = [r.model_dump() for r in body.regions]
    async with session.mutation:
        _require_writable(session)
        try:
            res = await run_in_threadpool(
                redact_ops.apply_redaction, session.work_path, regions, body.fill, body.images
            )
        except (pdflib.PdfError, redact_ops.RedactError):
            # Kein Snapshot vorher genommen -> kein after_failed_mutation noetig.
            raise
        # Irreversibel: Historie + Snapshots verwerfen (Spec Section 3 / Section 10).
        session.reset()
        session.dirty = True
        session.write_marker()
    return res


# ------------------------------------------------ Sanitise / Scrub / Flatten (Section 10/7/11)
@router.post("/security/sanitize")
async def sanitize_route(request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("SANITIZE")
        try:
            res = await run_in_threadpool(security_ops.sanitize, session.work_path)
        except (pdflib.PdfError, security_ops.SecurityError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/document/scrub-metadata")
async def scrub_metadata_route(request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("SCRUB_METADATA")
        try:
            res = await run_in_threadpool(security_ops.scrub_metadata, session.work_path)
        except (pdflib.PdfError, security_ops.SecurityError):
            session.after_failed_mutation()
            raise
    return res


@router.post("/document/flatten")
async def flatten_route(body: FlattenRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("FLATTEN")
        try:
            res = await run_in_threadpool(security_ops.flatten, session.work_path, body.categories)
        except (pdflib.PdfError, security_ops.SecurityError):
            session.after_failed_mutation()
            raise
    return res


# ------------------------------------------------ Export / Konvertierung (Section 12)
@router.post("/export/images")
async def export_images_route(body: ExportImagesRequest, request: Request) -> dict:
    # Erzeugt neue Dateien, Quelle unveraendert -> kein Command.
    session = _session(request)
    _require(session)
    base = body.baseName or _default_base(session)
    return await run_in_threadpool(
        export_ops.export_images, session.work_path, body.expr, body.destDir, body.fmt, body.dpi, base)


@router.post("/export/text")
async def export_text_route(body: ExportTextRequest, request: Request) -> dict:
    session = _session(request)
    _require(session)
    base = body.baseName or _default_base(session)
    return await run_in_threadpool(export_ops.export_text, session.work_path, body.expr, body.destDir, body.fmt, base)


@router.get("/export/text-preview")
async def export_text_preview(request: Request, expr: str = Query("all"), fmt: str = Query("txt")) -> dict:
    session = _session(request)
    _require(session)
    text = await run_in_threadpool(export_ops.document_text, session.work_path, expr, fmt)
    return {"text": text, "format": fmt, "chars": len(text)}


@router.post("/export/images-to-pdf")
async def images_to_pdf_route(body: ImagesToPdfRequest, request: Request) -> dict:
    # Braucht keine offene Datei (Eingabe sind Bilddateien).
    _session(request)
    return await run_in_threadpool(
        export_ops.images_to_pdf, body.paths, body.destDir, body.pageSize, body.orientation,
        body.baseName or "converted")


@router.post("/export/compress")
async def compress_route(body: CompressRequest, request: Request) -> dict:
    # Schreibt eine neue optimierte Datei, Original unveraendert -> kein Command.
    session = _session(request)
    _require(session)
    return await run_in_threadpool(
        export_ops.compress, session.work_path, body.destDir, body.targetDpi, body.jpegQuality, body.baseName)


@router.post("/export/linearise")
async def linearise_route(body: LineariseRequest, request: Request) -> dict:
    # Schreibt eine neue lineare Datei, Original unveraendert -> kein Command.
    session = _session(request)
    _require(session)
    # Section 2.7: Linearisieren ist mit Verschluesselung unvereinbar (qpdf). Vorher ablehnen.
    if session.encryption and session.encryption.get("active"):
        raise export_ops.ExportError("Linearisieren ist bei verschluesselten Dokumenten nicht moeglich (Verschluesselung und linearizes PDF schliessen sich aus).")
    return await run_in_threadpool(
        export_ops.linearise, session.work_path, body.destDir, body.baseName)


# ---------------------------------------------------------------- Verschlüsselung (irreversibel)
@router.post("/document/encrypt")
async def encrypt_document(body: EncryptRequest, request: Request) -> dict:
    session = _session(request)
    if not body.password:
        raise security_ops.SecurityError("Oeffnungs-Passwort (User) darf nicht leer sein")
    owner = body.ownerPw or body.password
    async with session.mutation:
        _require_writable(session)
        # Architektur 4A: die Arbeitskopie bleibt unverschluesselt; AES-256 + Berechtigungen
        # werden erst beim Speichern angewandt (save_document). Deshalb kein Work-Copy-Op.
        # Irreversibel: Historie + Snapshots werden verworfen (Spec Section 3).
        session.reset()
        session.encryption = {
            "active": True, "user_pw": body.password,
            "owner_pw": owner, "permissions": body.permissions,
        }
        session.dirty = True
        session.write_marker()
    return {"encrypted": True, "algorithm": "AES-256 (R6)",
            "ownerDefaultsToUser": body.ownerPw is None}


@router.post("/document/decrypt")
async def decrypt_document(body: DecryptRequest, request: Request) -> dict:
    # Entschluesselt in eine NEUE Datei; veraendert die Session/Arbeitskopie nicht.
    session = _session(request)
    src = body.path or session.original_path
    if not src:
        raise pdflib.NoDocument("Kein Dokument geoeffnet")
    dest_dir = body.destDir or os.path.dirname(src) or "."
    return await run_in_threadpool(
        security_ops.remove_encryption_copy, src, body.ownerPassword, dest_dir, body.baseName
    )


# ---------------------------------------------------------------- Speichern
@router.post("/document/save")
async def save_document(body: SaveRequest, request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        target = body.path or session.original_path
        if not target:
            raise pdflib.WriteDenied("Kein Zielpfad angegeben")
        res = await run_in_threadpool(pdflib.save_document, session.work_path, target, session.encryption)
        # Save a Copy (rebind=False): Zielpfad wird geschrieben, aber die Session bleibt ans
        # Original gebunden und die Aenderungen gelten weiter als ungespeichert (Section 4).
        if body.path and body.rebind:
            session.original_path = body.path
        if body.rebind:
            session.discard_saved_changes()
    return {"saved": True, "path": res["path"], "encrypted": res["encrypted"]}


# ---------------------------------------------------------------- Stamping (undoable)
@router.post("/document/stamp")
async def stamp_image(body: StampRequest, request: Request) -> dict:
    session = _session(request)
    try:
        image_bytes = base64.b64decode(body.image, validate=True)
    except Exception as exc:
        raise crypto_ops.BadImage("Bild-Daten sind kein gueltiges base64") from exc
    rect = {"x": body.x, "y": body.y, "width": body.width, "height": body.height}
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("STAMP_IMAGE")
        try:
            res = await run_in_threadpool(crypto_ops.stamp_image, session.work_path, body.page, rect, image_bytes, body.keepProportion)
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return res


# ---------------------------------------------------------------- Signatur (irreversibel)
@router.post("/document/sign")
async def sign_document(body: SignRequest, request: Request) -> dict:
    session = _session(request)
    rect = {"x": body.x, "y": body.y, "width": body.width, "height": body.height}
    async with session.mutation:
        _require_writable(session)
        res = await run_in_threadpool(
            crypto_ops.sign_document, session.work_path, body.p12Path, body.password, body.page, rect, body.reason,
            name=body.name, location=body.location, invisible=body.invisible, image_b64=body.image,
            appearance=None if (body.invisible or body.image) else {"subject": body.signSubject},
            trust_certs=[__import__("base64").b64decode(c, validate=True) for c in body.caCerts[:6] if c] if body.caCerts else None
        )
        # Irreversibel: Historie + Snapshots verwerfen (Spec Section 3). Passwort nur als Argument, nie geloggt.
        session.reset()
        session.dirty = True
        session.write_marker()
    return res


@router.get("/pkcs11/devices")
async def pkcs11_devices(request: Request, module: str | None = Query(None)) -> dict:
    _session(request)
    return await run_in_threadpool(pkcs11_ops.list_devices, module)


@router.get("/pkcs11/certificates")
async def pkcs11_certificates(request: Request, module: str = Query(...), slot: int = Query(..., ge=0)) -> dict:
    _session(request)
    try:
        return await run_in_threadpool(pkcs11_ops.list_certificates, module, slot)
    except pkcs11_ops.Pkcs11Error:
        raise


@router.post("/pkcs11/verify-pin")
async def pkcs11_verify_pin(body: VerifyPinRequest) -> dict:
    return await run_in_threadpool(
        pkcs11_ops.verify_pin, body.module, body.slot, body.pin, body.sigPin
    )


@router.post("/document/remove-signatures")
async def document_remove_signatures(request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require_writable(session)
        session.before_mutation("REMOVE_SIGNATURES")
        try:
            res = await run_in_threadpool(pdflib.remove_signatures, session.work_path)
        except pdflib.PdfError:
            session.after_failed_mutation()
            raise
    return res


@router.post("/document/sign-pkcs11")
async def sign_document_pkcs11(body: SignPkcs11Request, request: Request) -> dict:
    session = _session(request)
    rect = {"x": body.x, "y": body.y, "width": body.width, "height": body.height}
    async with session.mutation:
        _require_writable(session)
        res = await run_in_threadpool(
            pkcs11_ops.sign_pdf_pkcs11, session.work_path,
            module_path=body.module, slot_id=body.slot, cert_id=body.certId,
            pin=body.pin, sig_pin=body.sigPin, page=body.page,
            rect=None if body.invisible else rect, invisible=body.invisible,
            reason=body.reason, name=body.name, location=body.location,
            appearance=None if body.invisible else {"subject": body.signSubject},
            image_b64=body.image, ca_certs_b64=body.caCerts)
        session.reset()
        session.dirty = True
        session.write_marker()
    return res


@router.get("/document/signatures")
async def document_signatures(request: Request) -> dict:
    session = _session(request)
    _require(session)
    return await run_in_threadpool(crypto_ops.verify_signatures, session.work_path)


# ------------------------------------------------ Signatur-Bibliothek + Zertifikate (Section 9)
# ------------------------------------------------ Vertrauensanker (R67)
@router.get("/trust/anchors")
async def trust_list() -> dict:
    return await run_in_threadpool(trust_ops.list_anchors)


@router.post("/trust/anchors")
async def trust_import(body: TrustImportRequest) -> dict:
    return await run_in_threadpool(trust_ops.import_anchor, body.cert, body.filename)


@router.delete("/trust/anchors/{anchor_id}")
async def trust_delete(anchor_id: str) -> dict:
    return await run_in_threadpool(trust_ops.delete_anchor, anchor_id)


@router.get("/signatures")
async def signatures_list() -> dict:
    return await run_in_threadpool(sig_lib.list_signatures)


@router.get("/signatures/{sid}/image")
async def signature_image(sid: str) -> Response:
    data, mime = await run_in_threadpool(sig_lib.read_signature_image, sid)
    return Response(content=data, media_type=mime)


@router.post("/signatures/import")
async def signature_import(body: SigImportRequest) -> dict:
    try:
        image_bytes = base64.b64decode(body.image, validate=True)
    except Exception:
        raise sig_lib.SignatureLibError("Bild ist kein gueltiges Base64") from None
    return await run_in_threadpool(
        sig_lib.import_signature_bytes, body.name or "Signatur", image_bytes, body.ext,
        body.sizePt, body.opacity)


@router.post("/signatures/import-file")
async def signature_import_file(body: SigImportFileRequest) -> dict:
    return await run_in_threadpool(
        sig_lib.import_signature_file, body.name or "Signatur", body.path, body.sizePt, body.opacity)


@router.post("/signatures/text")
async def signature_text(body: SigTextRequest) -> dict:
    png = await run_in_threadpool(
        sig_lib.text_to_png, body.text, body.fontname, body.fontsize, body.color or "#000000")
    return await run_in_threadpool(
        sig_lib.import_signature_bytes, body.name or body.text, png, ".png", body.sizePt, body.opacity)


@router.delete("/signatures/{sid}")
async def signature_delete(sid: str) -> dict:
    return await run_in_threadpool(sig_lib.delete_signature, sid)


@router.post("/certificates/describe")
async def certificate_describe(body: CertDescribeRequest) -> dict:
    # Passwort nur im Speicher fuer diesen Aufruf; nichts wird gespeichert (Section 9).
    return await run_in_threadpool(crypto_ops.describe_pkcs12, body.path, body.password or "")


# ---------------------------------------------------------------- Undo / Redo
async def _history_response(session: DocumentSession) -> dict:
    count = await run_in_threadpool(pdflib.page_count, session.work_path) if session.is_open else 0
    return {
        "canUndo": len(session.undo_stack) > 0,
        "canRedo": len(session.redo_stack) > 0,
        "undoDepth": len(session.undo_stack),
        "pageCount": count,
    }


@router.post("/document/undo")
async def undo(request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require(session)
        session.undo()
    return await _history_response(session)


@router.post("/document/redo")
async def redo(request: Request) -> dict:
    session = _session(request)
    async with session.mutation:
        _require(session)
        session.redo()
    return await _history_response(session)


# ---------------------------------------------------------------- Debug / Versionen (Section 6)
@router.get("/debug/versions")
async def debug_versions() -> dict:
    """Versionen fuer den KI-Diagnose-Dump. Docling wird nur per find_spec geprueft, NIEMALS
    importiert (Section 5.3: der Kern importiert Docling nicht)."""
    import importlib.metadata as md
    import importlib.util as u
    import sys

    def ver(name: str) -> str:
        try:
            return md.version(name)
        except Exception:  # noqa: BLE001 - fehlendes Paket ist kein Fehler, sondern "n/a"
            return "n/a"

    return {
        "python": sys.version.split()[0],
        "protocolVersion": "1.0",
        "libraries": {
            "fastapi": ver("fastapi"),
            "pydantic": ver("pydantic"),
            "PyMuPDF": ver("PyMuPDF"),
            "pikepdf": ver("pikepdf"),
            "pyHanko": ver("pyhanko"),
            "cryptography": ver("cryptography"),
            "openai": ver("openai"),
            "httpx": ver("httpx"),
        },
        "doclingAvailable": u.find_spec("docling") is not None,
    }


@router.post("/document/properties")
async def document_properties(body: PropertiesRequest, request: Request) -> dict:
    # Read-only: nur Fakten lesen -> kein Command, kein Schreibrecht noetig.
    session = _session(request)
    _require(session)
    res = await run_in_threadpool(
        properties_ops.collect_properties, session.work_path, session.original_path, body.page
    )
    res["pendingEncryption"] = bool(session.encryption and session.encryption.get("active"))
    return res


@router.post("/document/close")
async def close_document(request: Request) -> dict:
    # Session schliessen: kein Command, keine Mutation. Auch ohne geoeffnetes Dokument erlaubt.
    session = _session(request)
    session.close()
    return session.state()
