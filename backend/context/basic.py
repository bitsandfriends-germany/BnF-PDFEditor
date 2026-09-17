"""BasicProvider: Dokument-Kontext ausschliesslich mit PyMuPDF (immer verfuegbar, Spec 5.3).

- Textblaue mit Seitenzahl und Bounding-Box (block-level, nicht glyph-level laut 5.3.1).
- Plausible Leseordnung: Sortierung nach (y-Zeile, x). Fuer mehrspaltige Layouts bewusst schwach —
  das ist die dokumentierte Einschraenkung gegenuen Docling (kein Spaltenerkennung, kein OCR).
- Ueberschriften heuristisch aus Schriftgroesse/ Fetheit abgeleitet.
- Gescannte Seiten ohne Textebene fuehren Bild-Regionen als Elemente (Typ 'image') — kein OCR hier.

get_text('dict')-Struktur am installierten PyMuPDF 1.28.2 verifiziert:
  page -> {width,height,blocks}; block -> {type(number),bbox,lines} (type 1 = Bild);
  line -> {spans,bbox,dir,wmode}; span -> {text,size,flags,font,bbox,origin};
  Fetthaltung ueber Flags-Bit 16; page.rotation in {0,90,180,270}.
"""
from __future__ import annotations

import os
import statistics
from typing import Callable, List

from .base import (
    CONTEXT_PROTOCOL_VERSION,
    DocumentContextProvider,
    OnProgress,
    ShouldCancel,
    is_cancelled,
    write_manifest,
    write_page_jsonl,
    write_progress,
)

_BOLD_FLAG = 16


class BasicProvider(DocumentContextProvider):
    name = "basic"

    def is_available(self) -> bool:
        return True

    def describe(self) -> dict:
        return {"name": self.name, "available": True, "quality": "basis"}

    def convert(
        self,
        work_path: str,
        context_dir: str,
        source_sha: str,
        on_progress: OnProgress,
        should_cancel: ShouldCancel,
    ) -> dict:
        import pymupdf as fitz

        doc = fitz.open(work_path)
        try:
            total = doc.page_count
            page_index: List[dict] = []
            for idx in range(total):
                if should_cancel():
                    write_progress(context_dir, {"status": "cancelled", "done": idx, "total": total, "provider": self.name})
                    return {"status": "cancelled", "provider": self.name, "pageCount": idx, "total": total}
                page = doc.load_page(idx)
                elements = _extract_page(page, idx)
                nbytes = write_page_jsonl(context_dir, idx, elements)
                page_index.append({"page": idx, "file": f"page-{idx:06d}.jsonl", "bytes": nbytes, "elements": len(elements)})
                on_progress(idx + 1, total)
            manifest = {
                "status": "done",
                "provider": self.name,
                "sourceSha256": source_sha,
                "protocolVersion": CONTEXT_PROTOCOL_VERSION,
                "pageCount": total,
                "pages": page_index,
            }
            write_manifest(context_dir, manifest)
            write_progress(context_dir, {"status": "done", "done": total, "total": total, "provider": self.name})
            return manifest
        finally:
            doc.close()


def _extract_page(page, page_number: int) -> List[dict]:
    d = page.get_text("dict")
    raw_blocks = d.get("blocks", [])

    text_blocks = [b for b in raw_blocks if b.get("type") == 0 and b.get("lines")]
    image_blocks = [b for b in raw_blocks if b.get("type") == 1]

    # Korpusweite Median-Schriftgroesse als Referenz fuer die Ueberschriften-Heuristik.
    sizes = [
        span["size"]
        for b in text_blocks
        for line in b["lines"]
        for span in line.get("spans", [])
        if span.get("size")
    ]
    median = statistics.median(sizes) if sizes else 0.0

    # Leseordnung: grobe Zeilen-Bucket-Sortierung nach y, dann x (Dokumentation: schwach bei Spalten).
    text_blocks.sort(key=lambda b: (round(b["bbox"][1] / 8.0), b["bbox"][0]))

    out: List[dict] = []
    for b in text_blocks:
        spans = [span for line in b["lines"] for span in line.get("spans", [])]
        text = "".join(s.get("text", "") for s in spans).strip()
        if not text:
            continue
        max_size = max((s.get("size", 0.0) for s in spans), default=0.0)
        bold = any((s.get("flags", 0) & _BOLD_FLAG) for s in spans)
        one_line = len(b["lines"]) <= 1
        ratio = (max_size / median) if median > 0 else 0.0
        is_heading = (median > 0 and ratio >= 1.3) or (bold and one_line and len(text) <= 80)
        level = 0
        if is_heading:
            level = 1 if ratio >= 1.6 else (2 if ratio >= 1.3 else 3)
        out.append(
            {
                "page": page_number,
                "type": "text",
                "bbox": [round(float(x), 2) for x in b["bbox"]],
                "text": text,
                "heading": bool(is_heading),
                "level": level,
                "fontSize": round(max_size, 2),
                "bold": bool(bold),
            }
        )

    for b in image_blocks:
        out.append(
            {
                "page": page_number,
                "type": "image",
                "bbox": [round(float(x), 2) for x in b["bbox"]],
                "text": "",
            }
        )
    return out


def basic_worker_main(work_path: str, context_dir: str, source_sha: str) -> None:
    """Einstiegspunkt fuer den Workerprozess (pickelbar; nur Pfade als Argumente)."""

    def _on_progress(done: int, total: int) -> None:
        write_progress(context_dir, {"status": "running", "done": done, "total": total, "provider": "basic"})

    def _should_cancel() -> bool:
        return is_cancelled(context_dir)

    provider = BasicProvider()
    provider.convert(work_path, context_dir, source_sha, _on_progress, _should_cancel)
