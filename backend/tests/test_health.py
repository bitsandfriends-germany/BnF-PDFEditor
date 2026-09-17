"""Pytest für das Step-2-Backend: /health token-befreit, Rest 401 ohne/ falsches Token.

Ausführung (aus dem Repo-Root, im Backend-venv):
    pytest backend/tests
"""
from __future__ import annotations

import os
import sys

# Repo-Root in den Importpfad, damit `backend.main` importbar ist.
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# Token VOR dem Import setzen, damit das Modul ihn beim Laden liest.
os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

from fastapi.testclient import TestClient  # noqa: E402
from backend import main  # noqa: E402


def client() -> TestClient:
    return TestClient(main.app)


def test_health_ist_token_befreit():
    r = client().get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["protocolVersion"] == "1.0"
    assert body["pid"] == os.getpid()  # TestClient laeuft im selben Prozess


def test_geschuetzte_route_ohne_token_gibt_401():
    r = client().get("/whoami")
    assert r.status_code == 401
    assert r.json()["error"] == "unauthorized"


def test_geschuetzte_route_mit_falschem_token_gibt_401():
    r = client().get("/whoami", headers={"X-Auth-Token": "falsch"})
    assert r.status_code == 401


def test_geschuetzte_route_mit_korrektorem_token_gibt_200():
    r = client().get("/whoami", headers={"X-Auth-Token": "test-token-xyz"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_docs_ohne_entwicklermodus_sind_nicht_sichtbar():
    # Default ('Nur App'): Swagger/OpenAPI existieren nicht frei; ohne Token nie 200.
    assert client().get("/openapi.json").status_code != 200
    assert client().get("/docs").status_code != 200


def test_cors_preflight_vom_lokalen_origin_wird_nicht_401():
    # Regression: der Renderer ruft cross-origin auf (Dev http://localhost:<vitePort>, Prod
    # file:// -> Origin "null"). Der OPTIONS-Preflight traegt kein Token; er darf NICHT von der
    # Auth-Middleware mit 401 abgewiesen werden, sonst blockiert der Browser -> "network"-Fehler.
    r = client().options(
        "/document/open",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-auth-token",
        },
    )
    assert r.status_code in (200, 204)
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_gewaehrt_nur_lokale_origins_und_null():
    c = client()
    assert c.get("/health", headers={"Origin": "http://localhost:5173"}).headers.get(
        "access-control-allow-origin"
    ) == "http://localhost:5173"
    assert c.get("/health", headers={"Origin": "http://127.0.0.1:5173"}).headers.get(
        "access-control-allow-origin"
    ) == "http://127.0.0.1:5173"
    assert c.get("/health", headers={"Origin": "null"}).headers.get(
        "access-control-allow-origin"
    ) == "null"
    # Fremd-Origin erhaelt KEINE CORS-Freigabe.
    assert c.get("/health", headers={"Origin": "https://evil.example"}).headers.get(
        "access-control-allow-origin"
    ) is None
