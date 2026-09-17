"""R74 Nutzerbefund ("Programm laesst sich nicht starten").

Ursache war ein VERWAISTES Backend: blieb der Electron-Hauptprozess hart (SIGKILL/Absturz) weg,
lief das Python-Backend unbegrenzt weiter (PPID 1) und blockierte Sitzung/Ports, sodass ein
Neustart scheiterte. Dieser Test startet das ECHTE Backend als Kind eines Wrapper-Prozesses, toetet
den Wrapper (das Backend wird damit zum Waisen) und prueft, dass es sich SELBST beendet.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[2]
_PY = _ROOT / "backend" / ".venv" / "bin" / "python"


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


@pytest.mark.skipif(not _PY.exists(), reason="Backend-venv fehlt")
def test_backend_beendet_sich_wenn_elternprozess_stirbt(tmp_path):
    """Beweis: nach dem Tod des Elternprozesses endet das Backend innerhalb weniger Sekunden."""
    backend = tmp_path / "backend.pid"
    # Wrapper (bash) startet das Backend im Hintergrund und beendet sich dann selbst NICHT —
    # wir toeten ihn gleich, damit das Backend verwaist.
    wrapper = subprocess.Popen(
        [
            "bash",
            "-c",
            f'"{_PY}" -u main.py > "{tmp_path}/backend.out" 2>&1 & echo $! > "{backend}"; sleep 300',
        ],
        cwd=str(_ROOT / "backend"),
        env={
            **os.environ,
            "PDF_EDITOR_BACKEND_TOKEN": "orphan-test-token",
            "PDF_EDITOR_SESSION_DIR": str(tmp_path / "run"),
            "PDF_EDITOR_SNAPSHOT_DIR": str(tmp_path / "snap"),
            "PDF_EDITOR_DISABLE_DOCLING": "1",
        },
        start_new_session=True,
    )
    try:
        # Auf die pid des Backends warten (Wrapper schreibt sie sofort).
        deadline = time.time() + 20
        bp = 0
        while time.time() < deadline:
            if backend.exists() and backend.read_text().strip():
                bp = int(backend.read_text().strip())
                break
            time.sleep(0.2)
        assert bp > 0, "Backend-Prozess wurde nicht gestartet"
        assert _alive(bp), "Backend laeuft nicht"

        # Elternprozess hart beenden -> das Backend wird zum Waisen (PPID 1).
        os.kill(wrapper.pid, signal.SIGKILL)
        wrapper.wait(timeout=10)
        time.sleep(0.5)
        assert _alive(bp), "Backend soll zunaechst weiterlaufen (Waisenphase)"

        # Der Waechter im Backend muss es binnen weniger Sekunden beenden.
        deadline = time.time() + 25
        while time.time() < deadline and _alive(bp):
            time.sleep(0.5)
        if _alive(bp):
            os.kill(bp, signal.SIGKILL)
            out = (tmp_path / "backend.out").read_text(errors="replace")[-800:]
            pytest.fail(f"Verwaistes Backend lief weiter (pid {bp}). Ausgabe:\n{out}")
    finally:
        if wrapper.poll() is None:
            wrapper.kill()


def test_watchdog_reagiert_nur_auf_wechselnden_elternprozess():
    """Der Waechter vergleicht die PPID mit dem Startwert — kein Fehlalarm ohne Elternwechsel."""
    src = (_ROOT / "backend" / "main.py").read_text()
    assert "_parent_watchdog" in src
    assert "os.getppid() != parent" in src
    assert "server.should_exit = True" in src
