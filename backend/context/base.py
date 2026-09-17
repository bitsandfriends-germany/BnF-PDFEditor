"""Gemeinsame Grundlagen der Dokument-Kontext-Schicht (Step 5, Spec 5.3 / 5.3.1).

Ein Provider schreibt sein Ergebnis als JSONL (eine Datei pro Seite) plus manifest.json in den
Session-Ordner (Runtime-Dir, tmpfs laut Section 2) — nie als grosses JSON-Payload ueber HTTP.
Der contextId schluesselt Quelle-Inhalt (SHA-256) UND erzeugenden Provider; ein Providerwechsel
erzeugt damit zwangslaeufig einen anderen Cache-Eintrag (= Invalidate).
"""
from __future__ import annotations

import hashlib
import json
import os
from abc import ABC, abstractmethod
from typing import Callable, Optional

# Versionshandshake fuer Sidecar-Protokoll und Manifest-Format.
CONTEXT_PROTOCOL_VERSION = "1.0"

# Zielgroesse pro Chunk in Token (5.4 Nr.1); der Provider selbst liefert Blocks, das Chunking
# uebernimmt Step 6 — hier nur als Dokumentations-Konstante abgelegt.
CHUNK_TARGET_TOKENS = (400, 800)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def context_root(runtime_dir: str) -> str:
    return os.path.join(runtime_dir, "context")


def context_dir_for(runtime_dir: str, source_sha: str, provider: str) -> str:
    return os.path.join(context_root(runtime_dir), f"{source_sha[:16]}__{provider}")


def context_id(source_sha: str, provider: str) -> str:
    return f"{source_sha[:16]}__{provider}"


def make_context_dir(runtime_dir: str, source_sha: str, provider: str) -> str:
    d = context_dir_for(runtime_dir, source_sha, provider)
    os.makedirs(d, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    return d


def write_page_jsonl(context_dir: str, page: int, elements: list[dict]) -> int:
    """Schreibt die Kontext-Elemente einer Seite als JSONL (eine Zeile pro Block/Region)."""
    path = os.path.join(context_dir, f"page-{page:06d}.jsonl")
    with open(path, "w", encoding="utf-8") as fh:
        for el in elements:
            fh.write(json.dumps(el, ensure_ascii=False) + "\n")
    return os.path.getsize(path)


def read_page_jsonl(context_dir: str, page: int) -> list[dict]:
    path = os.path.join(context_dir, f"page-{page:06d}.jsonl")
    if not os.path.isfile(path):
        return []
    out: list[dict] = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def write_manifest(context_dir: str, manifest: dict) -> None:
    tmp = os.path.join(context_dir, ".manifest.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, os.path.join(context_dir, "manifest.json"))


def read_manifest(context_dir: str) -> Optional[dict]:
    path = os.path.join(context_dir, "manifest.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def write_progress(context_dir: str, progress: dict) -> None:
    """Fortschritt festschreiben (wird per SSE ueberwacht)."""
    tmp = os.path.join(context_dir, ".progress.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(progress, fh, ensure_ascii=False)
    os.replace(tmp, os.path.join(context_dir, "progress.json"))


def read_progress(context_dir: str) -> Optional[dict]:
    path = os.path.join(context_dir, "progress.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None


def cancel_flag_path(context_dir: str) -> str:
    return os.path.join(context_dir, "CANCEL")


def is_cancelled(context_dir: str) -> bool:
    return os.path.exists(cancel_flag_path(context_dir))


def request_cancel(context_dir: str) -> None:
    open(cancel_flag_path(context_dir), "a", encoding="utf-8").close()


OnProgress = Callable[[int, int], None]
ShouldCancel = Callable[[], bool]


class DocumentContextProvider(ABC):
    """Einheitliche Schnittstelle; Features wissen nicht, welche Implementierung liefert (5.1)."""

    name: str = "abstract"

    @abstractmethod
    def is_available(self) -> bool:
        """Ob dieser Provider aktuelle Kontexte liefern kann (Basic immer True; Docling = Sidecar da)."""

    @abstractmethod
    def describe(self) -> dict:
        """Metadaten fuer UI/Feature-Detection: {name, available, version?, reason?}."""

    @abstractmethod
    def convert(
        self,
        work_path: str,
        context_dir: str,
        source_sha: str,
        on_progress: OnProgress,
        should_cancel: ShouldCancel,
    ) -> dict:
        """Wandelt um, schreibt page-*.jsonl + manifest.json in context_dir, liefert das Manifest.

        Wird in einem separaten Workerprozess aufgerufen, nie im FastAPI-Eventloop.
        """
