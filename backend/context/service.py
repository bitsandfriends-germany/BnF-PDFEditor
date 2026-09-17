"""ContextService (Step 5): orchestriert Provider, Cache und Worker-Prozess.

Der einzige Ort, an dem zwischen Basic- und Docling-Provider verzweigt wird (Spec 5.1: "no feature
contains scattered if docling_available checks"). Der Cache ist nach (SHA-256 des Arbeitskopie-
Inhalts, Provider) schluesselt; ein Providerwechsel erzeugt damit einen anderen Eintrag (= Invalidate).

Grund-Konvertierung laeuft in einem separaten Workerprozess (multiprocessing), nie im Eventloop;
der Docling-Pfad spawnt zusaetzlich seinen eigenen Sidecar. Beide schreiben progress.json in den
Context-Ordner, worueber SSE und Abbruch einheitlich arbeiten.
"""
from __future__ import annotations

import glob
import multiprocessing as mp
import os
from typing import Dict, Optional

from backend.pdflib import PdfError

from .base import (
    DocumentContextProvider,
    context_id,
    is_cancelled,
    make_context_dir,
    read_manifest,
    read_page_jsonl,
    read_progress,
    request_cancel,
    sha256_file,
    write_progress,
)
from .basic import BasicProvider, basic_worker_main
from .docling import DoclingProvider


def _quick_page_count(path: str) -> int:
    import pymupdf as fitz

    d = fitz.open(path)
    try:
        return d.page_count
    finally:
        d.close()


class ContextService:
    def __init__(self) -> None:
        self._basic = BasicProvider()
        self._docling = DoclingProvider()
        self._procs: Dict[str, "mp.Process"] = {}

    # ------------------------------------------------------------ Provider-Auswahl
    def providers_info(self) -> list[dict]:
        return [self._basic.describe(), self._docling.describe()]

    def docling_available(self) -> bool:
        return self._docling.is_available()

    def select(self, name: Optional[str]) -> DocumentContextProvider:
        if name == "basic":
            return self._basic
        if name == "docling":
            if not self._docling.is_available():
                raise DoclingUnavailable("Docling-Sidecar ist nicht installiert/kompatibel")
            return self._docling
        # automatisch: bevorzugt Docling, sonst Basis.
        return self._docling if self._docling.is_available() else self._basic

    # ------------------------------------------------------------ Analyse starten
    def analyze(self, work_path: str, runtime_dir: str, provider_name: Optional[str]) -> dict:
        source_sha = sha256_file(work_path)
        provider = self.select(provider_name)
        cid = context_id(source_sha, provider.name)
        ctx_dir = make_context_dir(runtime_dir, source_sha, provider.name)

        cached = read_manifest(ctx_dir)
        if (
            cached is not None
            and cached.get("status") == "done"
            and cached.get("provider") == provider.name
            and cached.get("sourceSha256") == source_sha
        ):
            return {"contextId": cid, "status": "done", "provider": provider.name,
                    "pageCount": cached.get("pageCount", 0), "fromCache": True}

        # verwaisten/teilweisen Eintrag verwerfen, neu starten
        self._purge(ctx_dir)
        write_progress(ctx_dir, {"status": "running", "done": 0, "total": 0, "provider": provider.name})
        total = _quick_page_count(work_path)

        if provider.name == "basic":
            proc = mp.get_context("spawn").Process(
                target=basic_worker_main, args=(work_path, ctx_dir, source_sha), daemon=False
            )
            proc.start()
            self._procs[cid] = proc
        else:
            # DoclingProvider managt seinen eigenen Sidecar; hier im Thread (nicht Eventloop).
            import threading

            def _run() -> None:
                provider.convert(work_path, ctx_dir, source_sha,
                                 lambda d, t: None, lambda: is_cancelled(ctx_dir))

            t = threading.Thread(target=_run, daemon=True)
            t.start()

        return {"contextId": cid, "status": "running", "provider": provider.name,
                "pageCount": total, "fromCache": False}

    # ------------------------------------------------------------ Lesen (Range)
    def manifest(self, runtime_dir: str, cid: str) -> dict:
        ctx_dir = os.path.join(_runtime_context_root(runtime_dir), cid)
        man = read_manifest(ctx_dir)
        if man is not None:
            return {"contextId": cid, **man}
        prog = read_progress(ctx_dir) or {"status": "unknown"}
        return {"contextId": cid, **prog}

    def pages(self, runtime_dir: str, cid: str, start: int, end: Optional[int]) -> dict:
        ctx_dir = os.path.join(_runtime_context_root(runtime_dir), cid)
        man = read_manifest(ctx_dir)
        total = man.get("pageCount", 0) if man else 0
        end_i = total if end is None else min(end, total)
        out: list[dict] = []
        for p in range(max(0, start), max(0, end_i)):
            out.extend(read_page_jsonl(ctx_dir, p))
        return {"contextId": cid, "from": start, "to": end_i, "elements": out}

    def regions(self, runtime_dir: str, cid: str, page: int) -> dict:
        ctx_dir = os.path.join(_runtime_context_root(runtime_dir), cid)
        els = read_page_jsonl(ctx_dir, page)
        return {"contextId": cid, "page": page, "regions": els}

    def progress(self, runtime_dir: str, cid: str) -> dict:
        ctx_dir = os.path.join(_runtime_context_root(runtime_dir), cid)
        return read_progress(ctx_dir) or {"status": "unknown"}

    # ------------------------------------------------------------ Abbruch
    def cancel(self, runtime_dir: str, cid: str) -> dict:
        ctx_dir = os.path.join(_runtime_context_root(runtime_dir), cid)
        request_cancel(ctx_dir)
        proc = self._procs.get(cid)
        if proc is not None and proc.is_alive():
            try:
                proc.terminate()
            except Exception:
                pass
        write_progress(ctx_dir, {"status": "cancelled", "provider": None})
        return {"contextId": cid, "status": "cancelled"}

    @staticmethod
    def _purge(ctx_dir: str) -> None:
        for f in ("manifest.json", "progress.json", "CANCEL"):
            p = os.path.join(ctx_dir, f)
            if os.path.exists(p):
                os.remove(p)
        for g in glob.glob(os.path.join(ctx_dir, "page-*.jsonl")):
            os.remove(g)


class DoclingUnavailable(PdfError):
    code = "docling_unavailable"
    status = 422


def _runtime_context_root(runtime_dir: str) -> str:
    return os.path.join(runtime_dir, "context")
