"""Kontext-Routen (Step 5, Spec 5.3.1). LiefertHandles/Manifest, nie den ganzen Inhalt.

Seiten/Regionen werden per Range geholt; Fortschritt laeuft ueber SSE. Analyse aendert das Dokument
nicht (read-only erlaubt). Die Docling-Feature-Erkennung steht hier, damit das UI sie ohne Sidecar
richtig deaktivieren kann.
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from backend.routers import _require, _session
from backend.schemas import AnalyzeRequest

router = APIRouter()


def _service(request: Request):
    return request.app.state.context


@router.get("/context/providers")
async def context_providers(request: Request) -> dict:
    svc = _service(request)
    info = await run_in_threadpool(svc.providers_info)
    docling = next((p for p in info if p.get("name") == "docling"), {})
    return {
        "providers": info,
        "docling": bool(docling.get("available")),
        "protocolVersion": "1.0",
    }


@router.post("/context/analyze")
async def context_analyze(body: AnalyzeRequest, request: Request) -> dict:
    session = _session(request)
    _require(session)
    svc = _service(request)
    return await run_in_threadpool(svc.analyze, session.work_path, session.runtime_dir, body.provider)


@router.get("/context/{cid}/manifest")
async def context_manifest(cid: str, request: Request) -> dict:
    session = _session(request)
    return _service(request).manifest(session.runtime_dir, cid)


@router.get("/context/{cid}/pages")
async def context_pages(
    cid: str,
    request: Request,
    frm: int = Query(0, ge=0, alias="from"),
    to: int | None = Query(None, ge=0),
) -> dict:
    session = _session(request)
    return await run_in_threadpool(_service(request).pages, session.runtime_dir, cid, frm, to)


@router.get("/context/{cid}/regions")
async def context_regions(cid: str, request: Request, page: int = Query(ge=0)) -> dict:
    session = _session(request)
    return await run_in_threadpool(_service(request).regions, session.runtime_dir, cid, page)


@router.post("/context/{cid}/cancel")
async def context_cancel(cid: str, request: Request) -> dict:
    session = _session(request)
    return _service(request).cancel(session.runtime_dir, cid)


@router.get("/context/{cid}/stream")
async def context_stream(cid: str, request: Request) -> StreamingResponse:
    session = _session(request)
    svc = _service(request)
    runtime_dir = session.runtime_dir

    async def gen():
        last = None
        # Hochstens ~90 s beobachten; danach mit letztem Stand schliessen (kein Haengen).
        for _ in range(300):
            prog = svc.progress(runtime_dir, cid)
            if prog != last:
                yield "data: " + json.dumps({"contextId": cid, **prog}) + "\n\n"
                last = prog
            if prog.get("status") in ("done", "cancelled", "error"):
                break
            await asyncio.sleep(0.3)
        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")
