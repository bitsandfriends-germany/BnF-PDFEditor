"""DoclingProvider (Step 5, Spec 5.3):waehlt den Docling-Sidecar als SEPARATEN Prozess.

Dieses Modul importiert `docling` NIEMALS. Die Interpretergrenze ist eine Prozessgrenze, damit
Python-Version/PyTorch/ABI des Sidecars vom (eingefrorenen) Backend entkoppelt sind. Erkennung:
Datei-Existenz + `--version`-Handshake mit protocolVersion-Vergleich; eine Abweichung deaktiviert
den Provider mit klarer Gruenden statt erst bei der Konvertierung zu scheitern.
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import time

from .base import (
    CONTEXT_PROTOCOL_VERSION,
    DocumentContextProvider,
    OnProgress,
    ShouldCancel,
    read_manifest,
    write_progress,
)

# Aufloesung des Sidecar-Kommandos:
#   PDF_EDITOR_DOCLING_WORKER = Pfad zum Ausfuehrbaren ODER zu docling_worker.py
#   PDF_EDITOR_DOCLING_PYTHON = (nur noetig, wenn der Worker eine .py ist) Interpreter dafuer
_WORKER_ENV = "PDF_EDITOR_DOCLING_WORKER"
_PYTHON_ENV = "PDF_EDITOR_DOCLING_PYTHON"
_DEFAULT_BUNDLE = "/usr/lib/pdf-editor/docling-worker/docling-worker"


class DoclingProvider(DocumentContextProvider):
    name = "docling"

    def _resolve_command(self) -> list[str] | None:
        path = os.environ.get(_WORKER_ENV) or _DEFAULT_BUNDLE
        if path.endswith(".py"):
            py = os.environ.get(_PYTHON_ENV)
            if not py or not os.path.isfile(path):
                return None
            return [py, path]
        if not os.path.isfile(path) or not os.access(path, os.X_OK):
            return None
        return [path]

    def handshake(self) -> dict:
        cmd = self._resolve_command()
        if cmd is None:
            return {"available": False, "reason": "not-installed"}
        try:
            proc = subprocess.run(
                cmd + ["--version"], capture_output=True, text=True, timeout=5
            )
        except (OSError, subprocess.SubprocessError):
            return {"available": False, "reason": "spawn-failed"}
        for line in (proc.stdout or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if data.get("event") == "version":
                if data.get("protocolVersion") != CONTEXT_PROTOCOL_VERSION:
                    return {"available": False, "reason": "protocol-mismatch",
                            "found": data.get("protocolVersion")}
                if not data.get("available"):
                    return {"available": False, "reason": "docling-import-failed"}
                return {"available": True, "reason": "ok", "protocolVersion": data.get("protocolVersion")}
        return {"available": False, "reason": "no-handshake"}

    def is_available(self) -> bool:
        return self.handshake().get("available", False)

    def describe(self) -> dict:
        h = self.handshake()
        d = {"name": self.name, "available": bool(h.get("available")), "quality": "erweitert"}
        if not h.get("available"):
            d["reason"] = h.get("reason", "unknown")
        return d

    def convert(
        self,
        work_path: str,
        context_dir: str,
        source_sha: str,
        on_progress: OnProgress,
        should_cancel: ShouldCancel,
    ) -> dict:
        cmd = self._resolve_command()
        if cmd is None:
            write_progress(context_dir, {"status": "error", "provider": self.name, "error": "not-installed"})
            return {"status": "error", "provider": self.name, "error": "not-installed"}
        proc = subprocess.Popen(
            cmd + [work_path, context_dir],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            start_new_session=True,  # eigene Prozessgruppe -> ein Signal erwischt den ganzen Teilbaum
        )
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                et = ev.get("event")
                if et == "progress":
                    write_progress(context_dir, {"status": "running", "provider": self.name,
                                                 "done": ev.get("done"), "total": ev.get("total")})
                    on_progress(int(ev.get("done") or 0), int(ev.get("total") or 0))
                    if should_cancel():
                        self._terminate(proc)
                        write_progress(context_dir, {"status": "cancelled", "provider": self.name})
                        return {"status": "cancelled", "provider": self.name}
                elif et == "error":
                    write_progress(context_dir, {"status": "error", "provider": self.name, "error": ev.get("error")})
                    return {"status": "error", "provider": self.name, "error": ev.get("error")}
                elif et == "cancelled":
                    write_progress(context_dir, {"status": "cancelled", "provider": self.name})
                    return {"status": "cancelled", "provider": self.name}
            proc.wait()
        finally:
            if proc.poll() is None:
                self._terminate(proc)
        manifest = read_manifest(context_dir)
        if manifest and manifest.get("provider") == self.name:
            manifest["sourceSha256"] = source_sha
            return manifest
        write_progress(context_dir, {"status": "error", "provider": self.name, "error": "no-manifest"})
        return {"status": "error", "provider": self.name, "error": "no-manifest"}

    @staticmethod
    def _terminate(proc: "subprocess.Popen[str]") -> None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            return
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline and proc.poll() is None:
            time.sleep(0.05)
        if proc.poll() is None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
