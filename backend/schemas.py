"""Pydantic-v2-Request-/Response-Schemas fuer Step 3 (Spec Section 3).

Nur Request-Koerper werden strikt validiert; Antworten werden in den Routern als dicts
zurueckgegeben (bewusst schlank, camelCase nach aussen).
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class OpenRequest(BaseModel):
    path: str
    password: Optional[str] = None


class RotateRequest(BaseModel):
    page: int = Field(ge=0)
    delta: int = 90


class DeleteRequest(BaseModel):
    page: int = Field(ge=0)


class ReorderRequest(BaseModel):
    order: list[int]


class MergeRequest(BaseModel):
    path: str


class MetadataRequest(BaseModel):
    title: str = ""
    author: str = ""
    subject: str = ""
    keywords: str = ""


class EncryptRequest(BaseModel):
    password: str = Field(min_length=1)          # User-/Oeffnungs-Passwort
    ownerPw: Optional[str] = None                # Owner-Passwort (Rechte); defaultet auf password
    permissions: Optional[dict] = None           # {printing,copy,modify,annotate,form,accessibility,assembly}


class DecryptRequest(BaseModel):
    ownerPassword: str = Field(min_length=1)
    path: Optional[str] = None                    # Standard: Originalpfad der Session
    destDir: Optional[str] = None                 # Standard: Verzeichnis des Originals
    baseName: Optional[str] = None


class SaveRequest(BaseModel):
    # Ziel optional: ohne Angabe -> Ueberschreiben der Originaldatei.
    path: Optional[str] = None
    # Save a Copy schreibt woanders, OHNE die Session-Bindung zu aendern (rebind=False).
    rebind: bool = True


class StampRequest(BaseModel):
    # rect in PDF-User-Space (unten-links); image = base64-codiertes PNG/SVG.
    page: int = Field(ge=0)
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    image: str
    keepProportion: bool = True


class AnalyzeRequest(BaseModel):
    # Provider optional: None = automatisch (Docling bevorzugt, sonst Basic).
    provider: Optional[str] = None


class SignRequest(BaseModel):    # p12-Passwort wird NICHT geloggt/persistiert. rect = PDF-User-Space (unten-links).
    p12Path: str
    password: str = Field(min_length=1)
    page: int = Field(ge=0)
    x: float
    y: float
    width: float
    height: float
    reason: Optional[str] = None
    name: Optional[str] = None
    location: Optional[str] = None
    invisible: bool = False
    signSubject: Optional[str] = None  # Zert-CN fuer das gezeichnete Signatur-Aussehen
    image: Optional[str] = None
    caCerts: Optional[list[str]] = None  # CA-Zertifikate (base64 DER) fuer die eingebettete Vertrauenskette


# ------------------------------------------------- Seitenverwaltung (Section 6)
class RotatePagesRequest(BaseModel):
    expr: str = Field(min_length=1)   # Section-3-Seitenbereich
    delta: int = 90


class DeletePagesRequest(BaseModel):
    expr: str = Field(min_length=1)


class DuplicatePagesRequest(BaseModel):
    expr: str = Field(min_length=1)
    position: str = "end"             # 'start' | 'end' | 'before' | 'after'
    page: Optional[int] = Field(default=None, ge=1)  # fuer before/after (1-basiert)


class ExtractPagesRequest(BaseModel):
    expr: str = Field(min_length=1)
    destDir: str = Field(min_length=1)
    each: bool = False                # True -> eine Datei pro Seite
    baseName: Optional[str] = None


class SplitDocumentRequest(BaseModel):
    mode: str                          # 'at' | 'everyN' | 'points' | 'every'
    page: Optional[int] = Field(default=None, ge=1)
    count: Optional[int] = Field(default=None, ge=1)
    points: Optional[list[int]] = None
    destDir: str = Field(min_length=1)
    baseName: Optional[str] = None


class InsertSource(BaseModel):
    kind: str                              # 'blank' | 'image' | 'pdf'
    width: Optional[float] = None          # blank: pt
    height: Optional[float] = None         # blank: pt
    path: Optional[str] = None             # image/pdf: absoluter Pfad
    expr: Optional[str] = None             # pdf: Section-3-Auswahl; None = alle
    password: Optional[str] = None         # pdf: Quell-Passwort (wird nicht persistiert)
    scale: bool = False                    # pdf: auf Ziel-Seitengroesse skalieren (default aus)


class InsertPagesRequest(BaseModel):
    position: str = "end"                  # 'start' | 'end' | 'before' | 'after'
    page: Optional[int] = Field(default=None, ge=1)
    source: InsertSource


# ------------------------------------------------- Stempel / Seitenzahlen (Section 7)
class ImageStampSelectionRequest(BaseModel):
    expr: str = Field(min_length=1)        # Section-3-Auswahl
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    image: str                             # base64 (PNG/JPEG/SVG)
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    rotation: int = 0
    overlay: bool = True                   # False = hinter dem Inhalt
    keepProportion: bool = True


class TextStampRequest(BaseModel):
    expr: str = Field(min_length=1)
    x: float
    y: float
    text: str = Field(min_length=1)
    fontname: str = "helv"
    fontsize: float = Field(default=12, gt=0)
    color: Optional[str] = "#000000"
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    rotation: int = 0
    align: int = 0                          # 0 links, 1 mitte, 2 rechts
    overlay: bool = True


class PageNumbersRequest(BaseModel):
    expr: str = Field(min_length=1)
    position: str = "bottom-center"
    margin: float = Field(default=36.0, ge=0)
    format: str = "{n}"
    start: int = 1
    fontname: str = "helv"
    fontsize: float = Field(default=10, gt=0)
    color: Optional[str] = "#000000"


class WatermarkRequest(BaseModel):
    kind: str = "text"                      # 'text' | 'image'
    expr: str = Field(min_length=1)
    text: Optional[str] = None              # kind=text
    image: Optional[str] = None             # kind=image, base64
    x: float = 0.0                           # image: Kachel-Offset
    y: float = 0.0
    width: float = Field(default=200, gt=0)  # image: Kachelmasse
    height: float = Field(default=80, gt=0)
    angle: int = 45
    opacity: float = Field(default=0.2, ge=0.0, le=1.0)
    tiled: bool = False
    overlay: bool = False                   # False = hinter dem Inhalt
    fontname: str = "helv"
    fontsize: float = Field(default=60, gt=0)
    color: Optional[str] = "#808080"


class ExtractImagesRequest(BaseModel):
    expr: str = Field(min_length=1)
    destDir: str = Field(min_length=1)
    baseName: Optional[str] = None


# ------------------------------------------------- Roteierung / Sicherheit (Section 10)
class RedactRegion(BaseModel):
    page: int = Field(ge=1)
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class RedactRequest(BaseModel):
    regions: list[RedactRegion] = Field(min_length=1)
    fill: Optional[list[float]] = None       # [r,g,b] 0..1, Standard schwarz
    images: str = "pixels"                   # pixels | remove | none


class AddAnnotationRequest(BaseModel):    # rect in PDF-User-Space (unten-links); page 0-basiert wie ueblich im Backend
    page: int = Field(ge=0)
    type: str
    x: float
    y: float
    width: float = 0
    height: float = 0
    text: str = ""
    color: Optional[str] = None
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)
    author: str = ""
    fontsize: float = Field(default=12.0, gt=0)


class FillFormRequest(BaseModel):    # value: bool fuer Checkbox, sonst String (Combobox/Listbox/Radio: einer der options)
    name: str = Field(min_length=1)
    value: Any = None


class ResetFormRequest(BaseModel):
    names: Optional[list[str]] = None


class EditAnnotationRequest(BaseModel):    # rect = PDF-User-Space (unten-links), absolut; nur uebergebene Felder aendern
    id: str = Field(min_length=1)
    text: Optional[str] = None
    author: Optional[str] = None
    color: Optional[str] = None
    opacity: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    rect: Optional[dict] = None


class DeleteAnnotationRequest(BaseModel):
    id: str = Field(min_length=1)


class RemoveAnnotationsRequest(BaseModel):
    expr: Optional[str] = None   # Seitenbereich; None -> alle Seiten


class FlattenRequest(BaseModel):
    categories: Optional[list[str]] = None   # Teilmenge von ['annotations','forms']


# ------------------------------------------------- Export / Konvertierung (Section 12)
class ExportImagesRequest(BaseModel):
    expr: str = Field(min_length=1)
    destDir: str = Field(min_length=1)
    fmt: str = "png"                          # png | jpeg
    dpi: int = 150                            # 72 | 150 | 300 | 600
    baseName: Optional[str] = None


class ExportTextRequest(BaseModel):
    expr: str = Field(min_length=1)
    destDir: str = Field(min_length=1)
    fmt: str = "txt"                          # txt | md
    baseName: Optional[str] = None


class ImagesToPdfRequest(BaseModel):
    paths: list[str] = Field(min_length=1)
    destDir: str = Field(min_length=1)
    pageSize: str = "auto"                    # auto | a3 | a4 | letter | legal
    orientation: str = "auto"                 # auto | portrait | landscape
    baseName: Optional[str] = None


class CompressRequest(BaseModel):
    destDir: str = Field(min_length=1)
    targetDpi: int = 150
    jpegQuality: int = Field(default=60, ge=0, le=100)
    baseName: Optional[str] = None


class LineariseRequest(BaseModel):
    destDir: str = Field(min_length=1)
    baseName: Optional[str] = None


# ------------------------------------------------- Signatur-Bibliothek / Zertifikate (Section 9)
class TrustImportRequest(BaseModel):
    cert: str
    filename: Optional[str] = None


class SigImportRequest(BaseModel):
    name: Optional[str] = None
    image: str = Field(min_length=1)          # base64 (PNG/JPEG/SVG)
    ext: str = ".png"
    sizePt: float = Field(default=160, gt=0)
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)


class SigImportFileRequest(BaseModel):
    name: Optional[str] = None
    path: str = Field(min_length=1)
    sizePt: float = Field(default=160, gt=0)
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)


class SigTextRequest(BaseModel):
    name: Optional[str] = None
    text: str = Field(min_length=1)
    fontname: str = "helv"
    fontsize: float = Field(default=64, gt=0)
    color: Optional[str] = "#000000"
    sizePt: float = Field(default=160, gt=0)
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)


class CertDescribeRequest(BaseModel):
    path: str = Field(min_length=1)
    password: Optional[str] = None            # nur im Speicher, nie gespeichert


class PropertiesRequest(BaseModel):
    page: int = Field(default=1, ge=1)


class ImageObjectRect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class ImageObjectUpdateRequest(BaseModel):
    page: int = Field(ge=1)
    bbox: ImageObjectRect          # aktuelle Instanz-BBox (aus list), unten-links
    rect: ImageObjectRect          # neue Zielregion, unten-links
    rotateDelta: int = 0           # 90er-Schritte


class ImageObjectDeleteRequest(BaseModel):
    page: int = Field(ge=1)
    bbox: ImageObjectRect


class FsExistsRequest(BaseModel):
    path: str = Field(min_length=1)


class VerifyPinRequest(BaseModel):  # PINs werden NICHT geloggt/persistiert.
    module: str
    slot: int = Field(ge=0)
    pin: str = Field(min_length=1)
    sigPin: Optional[str] = None


class SignPkcs11Request(BaseModel):  # PIN(s) werden NICHT geloggt/persistiert.
    # R60-Nachtrag: eigenes Signaturbild (base64 PNG/JPG) — der Renderer sendet
    # 'image' auch hier; fehlendes Feld ergab HTTP 500 (Nutzerbefund 332abc38).
    module: str
    slot: int = Field(ge=0)
    certId: str = Field(min_length=2)      # hex CKA_ID
    pin: str = Field(min_length=1)
    sigPin: Optional[str] = None
    page: int = Field(ge=0)
    x: float = 0
    y: float = 0
    width: float = 0
    height: float = 0
    reason: Optional[str] = None
    name: Optional[str] = None
    location: Optional[str] = None
    invisible: bool = False
    signSubject: Optional[str] = None
    image: Optional[str] = None  # eigenes Signaturbild (base64 PNG/JPG)
    # R66: Aussteller-Zertifikate (base64 DER) aus demZertifikats-Read — werden in die
    # Signatur eingebettet, damit Pruefer die Kette bis zur Wurzel aufbauen koennen.
    caCerts: Optional[list[str]] = None
