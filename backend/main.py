"""FastAPI-Backend: Prozess-/IPC-Vertrag (Section 2) + PDF-Kernrouten (Step 3).

Prozessvertrag (unveraeglich):
- Bindet 127.0.0.1 an Port 0, Kernel vergibt den Port, Listening-Zeile als ERSTE stdout-Zeile.
- Danach nur noch JSON-Einzeiler auf stdout (Log-Bridge, Section 6).
- GET /health token-befreit; alle anderen Routen brauchen X-Auth-Token, sonst 401.

Step 3 haergelt die Dokumentrouten (backend/routers.py), den Mutation-Lock und die Session
(backend/session.py). Session-Verzeichnisse kommen aus der Umgebung (Electron setzt sie beim
Spawn): PDF_EDITOR_SESSION_DIR, PDF_EDITOR_SNAPSHOT_DIR, PDF_EDITOR_UNDO_TO_DISK.
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import signal
import socket
import sys
import tempfile
from contextlib import asynccontextmanager

# R74: Elternprozess SOFORT beim Prozessstart merken (noch vor uvicorn). Stirbt Electron waehrend
# des Startvorgangs, wird das Backend auf PPID 1 umgehaengt — ein spaeter gestarteter Waechter
# haette dann gegen den bereits neuen Wert verglichen und das verwaiste Backend liefe weiter.
_INITIAL_PPID = os.getppid()

# Repo-Root in den Importpfad, damit `python backend/main.py` UND `import backend.main` gehen.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.openapi.utils import get_openapi

from backend.ai.config import AiConfigStore
from backend.ai.router import router as ai_router
from backend.ai.secrets import SecretsManager
from backend.context import ContextService
from backend.context.router import router as context_router
from backend.log import emit
from backend.pdflib import PdfError
from backend.routers import router as pdf_router
from backend.session import DocumentSession

PROTOCOL_VERSION = "1.0"
BACKEND_VERSION = "0.1.0"
AUTH_ENV = "PDF_EDITOR_BACKEND_TOKEN"
HEALTH_PATH = "/health"

# Expositions-Schalter (Section 2 bleibt heilig: Bind ist immer 127.0.0.1).
# 'Nur App' (Default): Swagger/OpenAPI ist nirgends erreichbar. 'Entwickler-Modus'
# (PDF_EDITOR_DEV_DOCS=1) stellt /docs, /openapi.json, /redoc im Browser bereit — nur
# Routenstruktur/Schemas, keine Dokumentdaten; echte Endpunkte bleiben token-geschuetzt.
DEV_DOCS = os.environ.get("PDF_EDITOR_DEV_DOCS", "").strip().lower() in ("1", "true", "yes")
DOCS_PATHS = {"/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc"}
CORR_HEADER = "X-Correlation-Id"

# Erwartetes Token ausschliesslich aus der Umgebung (Electron setzt es beim Spawn).
_expected_token: str = os.environ.get(AUTH_ENV, "")


def _session_from_env() -> DocumentSession:
    runtime = os.environ.get("PDF_EDITOR_SESSION_DIR") or tempfile.mkdtemp(prefix="pdf-editor-run-")
    snap = os.environ.get("PDF_EDITOR_SNAPSHOT_DIR") or tempfile.mkdtemp(prefix="pdf-editor-snap-")
    undo_to_disk = os.environ.get("PDF_EDITOR_UNDO_TO_DISK", "1") != "0"
    os.makedirs(runtime, exist_ok=True)
    return DocumentSession(runtime, snap, undo_to_disk=undo_to_disk)


async def _parent_watchdog(server: uvicorn.Server, parent: int, interval: float = 2.0) -> None:
    """Beendet das Backend, wenn der Elternprozess (Electron) verschwindet.

    Ohne diesen Waechter blieb nach einem harten Ende des Hauptprozesses ein verwaistes Backend
    zurueck (PPID 1). Solche Reste blockieren die Sitzung und lassen einen Neustart scheitern.
    `parent` wird beim Prozessstart gemerkt (siehe _INITIAL_PPID), damit auch ein Tod des
    Elternprozesses WAEHREND des Startvorgangs erkannt wird.
    """
    while True:
        await asyncio.sleep(interval)
        if os.getppid() != parent or parent == 1:
            emit({"level": "warn", "action": "BACKEND_ORPHANED",
                  "payload": {"reason": "parent_exited", "oldPpid": parent, "newPpid": os.getppid()}})
            server.should_exit = True
            return


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Session pro Start aus der Umgebung bauen (Electron reicht die Sitzungsverzeichnisse durch).
    app.state.session = _session_from_env()

    # KI-Konfiguration einmal beim Start laden (danach ist die API die einzige Quelle der Wahrheit).
    try:
        app.state.ai_config.load()
    except Exception as exc:
        emit({"level": "warn", "action": "AI_CONFIG_LOAD_FAILED", "error": {"type": type(exc).__name__, "message": str(exc)}})

    # Graceful Shutdown: Electron sendet SIGTERM (Section 2). Handler nach uvicorns
    # capture_signals im laufenden Loop installieren, should_exit setzen => Exit 0 statt -15.
    server = getattr(app.state, "server", None)
    if server is not None:
        def _stop(_sig=None, _frm=None) -> None:
            server.should_exit = True

        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                loop.add_signal_handler(sig, _stop)
            except NotImplementedError:
                signal.signal(sig, _stop)

        # R74 Nutzerbefund ("Programm laesst sich nicht starten"): Wird der Electron-Hauptprozess
        # HART beendet (SIGKILL, Absturz), laeuft dieses Backend verwaist weiter und blockiert
        # Ports/Sitzungen. Der Waechter beendet es, sobald der Elternprozess verschwunden ist.
        watchdog = asyncio.create_task(_parent_watchdog(server, _INITIAL_PPID))
        try:
            yield
        finally:
            watchdog.cancel()
    else:
        yield


app = FastAPI(
    title="pdf-editor-backend",
    version=BACKEND_VERSION,
    lifespan=lifespan,
    # Docs nur im Entwickler-Modus registrieren; sonst existieren die Routen gar nicht.
    description=(
        "Lokales Backend des PDF-Editors. Bindet ausschliesslich 127.0.0.1. "
        "Alle Endpunkte ausser /health verlangen den Header X-Auth-Token."
    ),
    docs_url="/docs" if DEV_DOCS else None,
    redoc_url="/redoc" if DEV_DOCS else None,
    openapi_url="/openapi.json" if DEV_DOCS else None,
)
app.state.session = None  # wird im Startup gesetzt; /health und /whoami brauchen sie nicht
app.state.context = ContextService()  # Provider-Auswahl + Worker-Registry (Schritt 5)
app.state.ai_config = AiConfigStore(docling_detector=lambda: app.state.context.docling_available())
app.state.secrets = SecretsManager()  # API-Schluessel: keyring/session/file, nie im Log
app.state.ai_streams = {}  # streamId -> asyncio.Event (SSE-Abbruch)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    # correlationId verbindet Frontend- und Backend-Eintraege (Section 6).
    corr = request.headers.get(CORR_HEADER.lower(), "") or f"b{secrets.token_hex(6)}"
    request.state.corr_id = corr
    response = await call_next(request)
    response.headers[CORR_HEADER] = corr
    return response


@app.middleware("http")
async def auth_gate(request: Request, call_next):
    # /health ist die einzige vor dem Handshake erreichbare Route (readiness-Poll).
    if request.url.path == HEALTH_PATH and request.method == "GET":
        return await call_next(request)
    # Im Entwickler-Modus sind die Doku-Pfade (nur Schema, keine Daten) ohne Token erreichbar.
    if DEV_DOCS and request.url.path in DOCS_PATHS:
        return await call_next(request)
    # CORS-Preflight (OPTIONS) traegt niemals das Auth-Token — hier durchlassen; die
    # CORSMiddleware (aeusserste Schicht) beantwortet ihn. Ohne dieses Durchlassen wuerde der
    # Preflight 401 und der Browser die echte Anfrage blockieren ("network"-Fehler im Renderer).
    if request.method == "OPTIONS" and "access-control-request-method" in request.headers:
        return await call_next(request)
    token = request.headers.get("x-auth-token", "")
    if not _expected_token or not secrets.compare_digest(token, _expected_token):
        emit({"level": "warn", "action": "AUTH_REJECTED", "payload": {"path": request.url.path}})
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return await call_next(request)


# CORS: der Backend ist ausschliesslich an 127.0.0.1 gebunden und token-geschuetzt. Der Renderer
# laeuft im Dev-Modus auf http://localhost:<vitePort> und im Paket auf file:// (Origin "null") —
# beides cross-origin gegenueber dem dynamischen Backend-Port. Diese Middleware wird NACH den
# auth_gate-/correlation-Dekoratoren registriert und liegt damit als AEUSSERSTE Schicht, sodass
# Preflights vor der Authentifizierung beantwortet und Access-Control-* auf alle Antworten
# gesetzt werden. allow_credentials=False: das Token sitzt im Header, nicht im Cookie — damit ist
# '*' nicht noetig und lokale Origins reichen. Kein fremder Host wird durchgelassen.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"null|http://(localhost|127\.0\.0\.1)(:[0-9]+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(PdfError)
async def pdf_error_handler(request: Request, exc: PdfError):
    # Kein stilles Scheitern: stabiler Fehlercode + Message, kein Pfad-/Passwort-Leak.
    corr = getattr(request.state, "corr_id", None)
    emit(
        {
            "level": "warn",
            "action": "PDF_ERROR",
            "correlationId": corr,
            "payload": {"code": exc.code},
            "error": {"type": type(exc).__name__, "message": exc.message},
        }
    )
    return JSONResponse(status_code=exc.status, content={"error": exc.code, "message": exc.message, "correlationId": corr})


@app.get(HEALTH_PATH)
async def health() -> dict:
    # Nur Status + Version — niemals Dokumentdaten.
    return {
        "status": "ok",
        "version": BACKEND_VERSION,
        "protocolVersion": PROTOCOL_VERSION,
        "pid": os.getpid(),
    }


@app.get("/whoami")
async def whoami() -> dict:
    return {"ok": True}


app.include_router(pdf_router)
app.include_router(context_router)
app.include_router(ai_router)


def _custom_openapi() -> dict:
    # Swagger-UI soll ein Authorize-Feld fuer X-Auth-Token zeigen; 'Try it out' sendet es dann.
    # /health bleibt ausgenommen (vor dem Handshake erreichbar).
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    components = schema.setdefault("components", {})
    components["securitySchemes"] = {"X-Auth-Token": {"type": "apiKey", "in": "header", "name": "X-Auth-Token"}}
    schema["security"] = [{"X-Auth-Token": []}]
    for op in schema.get("paths", {}).get(HEALTH_PATH, {}).values():
        if isinstance(op, dict):
            op["security"] = []
    app.openapi_schema = schema
    return schema


if DEV_DOCS:
    app.openapi = _custom_openapi  # type: ignore[method-assign]


def _bind_socket() -> tuple[socket.socket, int]:
    """Socket auf 127.0.0.1:0; Kernel vergibt den Port (kein Pre-Scan => kein TOCTOU)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(2048)
    port = int(sock.getsockname()[1])
    return sock, port


def main() -> None:
    sock, port = _bind_socket()
    listening = {"event": "listening", "port": port, "pid": os.getpid(), "protocolVersion": PROTOCOL_VERSION}
    # Erste Zeile auf stdout, vor jedem Log, sofort geflusht (Section 2).
    sys.stdout.write(json.dumps(listening, separators=(",", ":")) + "\n")
    sys.stdout.flush()

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_config=None,   # stdout bleibt reine JSONL-Leitung
        access_log=False,
        lifespan="on",
    )
    server = uvicorn.Server(config)
    app.state.server = server
    emit({"level": "info", "action": "BACKEND_STARTING", "payload": {"port": port}})
    try:
        server.run(sockets=[sock])
    finally:
        sock.close()


if __name__ == "__main__":
    # Fuer den Fall, dass ein Kindprozess (BasicProvider-Worker) ueber multiprocessing.spawn
    # denselben Frozen-Einstieg erneut ausfuehrt (Section 3/5.3, PyInstaller-onedir): frueh
    # delegieren, damit der Kindpfad nicht den Server neu startet.
    import multiprocessing

    multiprocessing.freeze_support()
    main()
