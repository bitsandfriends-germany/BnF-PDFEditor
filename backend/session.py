"""Sitzungs‑ und Snapshot‑Verwaltung (Spec Section 3).

Undo ist snapshot‑basiert, nicht invers‑befehlsbasiert. Rein mechanisch:
  MUTATE : before = copy(work) -> undo_stack.push ; wende Mutation auf work an ; redo_stack leeren
  UNDO   : after = copy(work) -> redo_stack.push  ; work = copy(undo_stack.pop)
  REDO   : before = copy(work) -> undo_stack.push ; work = copy(redo_stack.pop)
  neue Mutation verwirft den redo-Zweig (seine Dateien werden geloescht).

Kopien erfolgen per Reflink (FICLONE/ioctl) mit Fallback auf normalen Copy; der Fallback wird
geloggt. Begrenzung ueber ein Storage-Budget (min(2 GB, 25 % freier Platz)), nicht ueber eine
feste Anzahl; bei Ueberschreitung werden die aeltesten Undo-Snapshots verworfen (Depth sinkt).
"""
from __future__ import annotations

import asyncio
import fcntl
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from .log import emit

# FICLONE aus linux/ioctl.h: _IOR(0x94, 9, __u64) = 0x40049409.
FICLONE = 0x40049409
BUDGET_CAP = 16 * 1024 * 1024 * 1024  # 16 GB — Undo praktisch unbegrenzt (Nutzerwunsch R53);
# Snapshot-Kosten sind auf CoW-Dateisystemen (btrfs reflink) nahezu null.


def reflink_or_copy(src: str, dst: str) -> bool:
    """Reflink-Kopie versuchen; bei Nichtunterstuetzung normal kopieren. True => Reflink genutzt."""
    try:
        sfd = os.open(src, os.O_RDONLY)
        try:
            dfd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            try:
                fcntl.ioctl(dfd, FICLONE, sfd)
                return True
            finally:
                os.close(dfd)
        finally:
            os.close(sfd)
    except OSError:
        if os.path.exists(dst):
            os.remove(dst)
        shutil.copy2(src, dst)
        try:
            os.chmod(dst, 0o600)
        except OSError:
            pass
        return False


def budget_bytes(snapshot_dir: str) -> int:
    """min(2 GB, 25 % des freien Platzes im Snapshot-Verzeichnis)."""
    try:
        free = shutil.disk_usage(snapshot_dir).free
    except OSError:
        free = BUDGET_CAP * 4
    return min(BUDGET_CAP, free // 4)


def _unlink(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


@dataclass
class Snap:
    path: str
    kind: str  # Typ der Mutation bzw. 'redo'/'undo'
    seq: int


class DocumentSession:
    def __init__(self, runtime_dir: str, snapshot_dir: str, undo_to_disk: bool = True) -> None:
        self.runtime_dir = runtime_dir
        self.snapshot_dir = snapshot_dir
        self.undo_to_disk = undo_to_disk
        self.work_path = os.path.join(runtime_dir, "work.pdf")
        self.marker_path = os.path.join(runtime_dir, "session.json")
        self.mutation = asyncio.Lock()
        self.undo_stack: list[Snap] = []
        self.redo_stack: list[Snap] = []
        self._counter = 0
        self.is_open = False
        self.original_path: Optional[str] = None
        self.read_only = False
        self.dirty = False
        # Encrypted-Status nur im Speicher; Passwörter werden NIEMALS geloggt/persistiert.
        self.encryption: Optional[dict] = None
        self.snap_dir = snapshot_dir if undo_to_disk else runtime_dir
        os.makedirs(self.runtime_dir, exist_ok=True)
        try:
            os.chmod(self.runtime_dir, 0o700)
        except OSError:
            pass
        os.makedirs(self.snap_dir, exist_ok=True)
        if undo_to_disk:
            try:
                os.chmod(self.snap_dir, 0o700)
            except OSError:
                pass

    # ---- Budget ----
    def _live_paths(self) -> list[str]:
        return [s.path for s in self.undo_stack] + [s.path for s in self.redo_stack]

    def _total_bytes(self) -> int:
        total = 0
        for p in self._live_paths():
            try:
                total += os.path.getsize(p)
            except OSError:
                pass
        return total

    def _enforce_budget(self) -> None:
        if not self.undo_to_disk:
            return
        budget = budget_bytes(self.snap_dir)
        evicted = 0
        while self.undo_stack and self._total_bytes() > budget:
            victim = self.undo_stack.pop(0)
            _unlink(victim.path)
            evicted += 1
        if evicted:
            emit(
                {
                    "level": "info",
                    "action": "SNAPSHOT_EVICT",
                    "payload": {"evicted": evicted, "depth": len(self.undo_stack), "budget": budget},
                }
            )

    def _next_name(self, kind: str) -> str:
        self._counter += 1
        safe = kind.replace("/", "_")
        return os.path.join(self.snap_dir, f"{self._counter}-{safe}.pdf")

    def _snapshot_into(self, kind: str) -> Snap:
        path = self._next_name(kind)
        used = reflink_or_copy(self.work_path, path)
        emit(
            {
                "level": "debug",
                "action": "SNAPSHOT",
                "payload": {"kind": kind, "reflink": used, "size": os.path.getsize(path) if os.path.exists(path) else 0},
            }
        )
        return Snap(path=path, kind=kind, seq=self._counter)

    # ---- Lebenszyklus ----
    def reset(self) -> None:
        for s in self.undo_stack + self.redo_stack:
            _unlink(s.path)
        self.undo_stack.clear()
        self.redo_stack.clear()
        self._counter = 0

    def open_document(self, original_path: str, read_only: bool, encrypted: bool, password: Optional[str] = None) -> None:
        self.reset()
        self.is_open = True
        self.original_path = original_path
        self.read_only = read_only
        self.dirty = False
        # Passwort nur im Speicher (niemals Marker/Log). Notwendig, um beim Speichern
        # dieselbe Verschluesselung erneut anzuwenden (Spec Section 4 "Speichern").
        self.encryption = {"active": True, "user_pw": password or "", "owner_pw": password or ""} if encrypted else None
        self.write_marker()

    def close(self) -> None:
        self.reset()
        self.is_open = False
        self.original_path = None
        self.read_only = False
        self.dirty = False
        self.encryption = None

    # ---- Snapshot-Mechanik ----
    def before_mutation(self, kind: str) -> Snap:
        """Vor einer Mutation den aktuellen Stand sichern. Nur aufrufen, wenn Mutation erlaubt ist."""
        if self.undo_to_disk:
            # redo-Zweig verwerfen (neuer Zweig)
            for s in self.redo_stack:
                _unlink(s.path)
            self.redo_stack.clear()
        else:
            # Depth 1: nur die letzte undo-Kopie behalten (im Runtime-Verzeichnis).
            for s in self.undo_stack + self.redo_stack:
                _unlink(s.path)
            self.undo_stack.clear()
            self.redo_stack.clear()
        snap = self._snapshot_into(kind)
        self.undo_stack.append(snap)
        self._enforce_budget()
        self.dirty = True
        self.write_marker()
        return snap

    def after_failed_mutation(self) -> None:
        """Schlaeft die soeben angelegte Vor-Mutations-Kopie wieder ein, wenn die OP fehlschlug."""
        if self.undo_stack:
            _unlink(self.undo_stack[-1].path)
            self.undo_stack.pop()

    def undo(self) -> bool:
        if not self.undo_stack:
            return False
        after = self._snapshot_into("redo")
        self.redo_stack.append(after)
        before = self.undo_stack.pop()
        reflink_or_copy(before.path, self.work_path)
        self.dirty = True
        self.write_marker()
        return True

    def redo(self) -> bool:
        if not self.redo_stack:
            return False
        before = self._snapshot_into("undo")
        self.undo_stack.append(before)
        after = self.redo_stack.pop()
        reflink_or_copy(after.path, self.work_path)
        self.dirty = True
        self.write_marker()
        return True

    def discard_saved_changes(self) -> None:
        """Nach erfolgreichem Save: Historie ist nicht mehr 'unsaved'."""
        self.dirty = False
        self.write_marker()

    # ---- Persistenz-Marker (ohne Passwörter, Section 3) ----
    def write_marker(self) -> None:
        try:
            with open(self.marker_path, "w", encoding="utf-8") as fh:
                fh.write(_json_dumps_marker(self))
        except OSError:
            pass

    def state(self) -> dict:
        # pageCount ist Teil des State-Antwortsatzes: der UI-Toolbar sonst nach jeder
        # Seiten-Mutation veraltet (E2E-Fund; /document/state ist der einzige Refresh-Pfad).
        page_count = 0
        if self.is_open:
            import pymupdf
            with pymupdf.open(self.work_path) as d:
                page_count = d.page_count
        return {
            "open": self.is_open,
            "originalPath": self.original_path,
            "readOnly": self.read_only,
            "dirty": self.dirty,
            "encrypted": bool(self.encryption and self.encryption.get("active")),
            "canUndo": len(self.undo_stack) > 0,
            "canRedo": len(self.redo_stack) > 0,
            "undoDepth": len(self.undo_stack),
            "pageCount": page_count,
        }


def _json_dumps_marker(session: DocumentSession) -> str:
    import json

    return json.dumps(
        {
            "originalPath": session.original_path,
            "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "dirty": session.dirty,
            "readOnly": session.read_only,
            "encrypted": bool(session.encryption and session.encryption.get("active")),
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
