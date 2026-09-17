"""AI-Routen (Step 6). Konfigurations-Lebenszyklus, Schluessel, Modelle, Kosten-Schaetzung,
SSE-Chat mit Abbruch. Schluessel werden niemals zurueckgegeben (auch nicht maskiert).
"""
from __future__ import annotations

import asyncio
import json
import secrets as _pysecrets

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from backend.routers import _require, _session

from . import client as ai_client
from .config import AiConfig
from .gateway import prepare_chat, stream_chat
from .secrets import KeyringUnavailable

router = APIRouter()


def _cfg(request: Request):
    return request.app.state.ai_config


def _secrets(request: Request):
    return request.app.state.secrets


def _streams(request: Request):
    return request.app.state.ai_streams


# ---------------------------------------------------------------- Konfiguration
@router.get("/config/ai")
async def get_ai_config(request: Request) -> dict:
    cfg = _cfg(request)
    store = cfg
    snapshot = store.get()
    view = snapshot.as_client_view()
    key_status = await _secrets(request).status(["text", "vision"])
    view["keyStatus"] = key_status
    view["version"] = store.version
    return view


@router.put("/config/ai")
async def put_ai_config(body: dict, request: Request) -> dict:
    store = _cfg(request)
    try:
        new = AiConfig.model_validate(body)
    except Exception as exc:
        from backend.pdflib import PdfError

        class ConfigError(PdfError):
            code = "config_invalid"
            status = 422

        raise ConfigError(f"Konfiguration ungueltig: {exc}") from exc
    applied = await run_in_threadpool(store.apply, new)
    return applied.as_client_view()


@router.post("/config/ai/test")
async def test_ai_config(body: dict, request: Request) -> dict:
    section = body.get("section", "text")
    cand = body.get("candidate", {})
    base_url = (cand.get("baseUrl") or "").strip()
    if not base_url:
        from backend.pdflib import PdfError

        class ConfigError(PdfError):
            code = "config_invalid"
            status = 422

        raise ConfigError("baseUrl erforderlich")
    api_key = await _secrets(request).get(section)
    return await ai_client.list_models(base_url, api_key)


# ---------------------------------------------------------------- Schluessel
@router.post("/config/ai/key")
async def set_ai_key(body: dict, request: Request) -> dict:
    section = body.get("section", "text")
    key = body.get("key", "")
    mode = body.get("mode")
    mgr = _secrets(request)
    if mode:
        mgr.set_mode(mode)
    if not key:
        res = await mgr.delete(section)
    else:
        try:
            res = await mgr.put(section, key)
        except KeyringUnavailable as exc:
            from backend.pdflib import PdfError

            class KeyringErr(PdfError):
                code = "keyring_unavailable"
                status = 503

            raise KeyringErr(str(exc)) from exc
    return res


@router.delete("/config/ai/key")
async def delete_ai_key(request: Request, section: str = "text") -> dict:
    return await _secrets(request).delete(section)


@router.get("/config/ai/key-status")
async def key_status(request: Request) -> dict:
    mgr = _secrets(request)
    return {"mode": mgr._mode, "keys": await mgr.status(["text", "vision"])}


# ---------------------------------------------------------------- Modelle / Schaetzung
@router.get("/ai/models")
async def ai_models(request: Request, section: str = "text") -> dict:
    cfg = _cfg(request).get()
    if section == "vision":
        vm = cfg.visionModel
        base_url = vm.baseUrl if vm else ""
    else:
        tm = cfg.textModel
        base_url = tm.baseUrl if tm else ""
    if not base_url:
        return {"ok": False, "models": [], "error": "not_configured", "message": "Keine Base-URL konfiguriert"}
    api_key = await _secrets(request).get(section)
    return await ai_client.list_models(base_url, api_key)


@router.post("/ai/estimate")
async def ai_estimate(body: dict, request: Request) -> dict:
    session = _session(request)
    _require(session)
    cfg = _cfg(request).snapshot()
    context_id = body.get("contextId")
    scope = _scope(body)
    prepared = await run_in_threadpool(
        prepare_chat, cfg, session.runtime_dir, context_id, body.get("question", ""), body.get("page"), scope, None
    )
    require_confirm = bool(cfg.privacy.confirmBeforeSend and prepared.nonlocal_host)
    return {
        "estimatedInputTokens": prepared.est_input_tokens,
        "pagesAffected": prepared.pages_used,
        "nonLocal": prepared.nonlocal_host,
        "host": prepared.host,
        "requireConfirm": require_confirm,
    }


# ---------------------------------------------------------------- Chat (SSE) + Abbruch
@router.post("/ai/chat")
async def ai_chat(body: dict, request: Request) -> StreamingResponse:
    session = _session(request)
    _require(session)
    cfg = _cfg(request).snapshot()  # In-Flight haelt Start-Snapshot.
    context_id = body.get("contextId")
    question = body.get("question", "")
    page = body.get("page")
    scope = _scope(body)
    stream_id = "s" + _pysecrets.token_hex(6)
    cancel_event = asyncio.Event()
    _streams(request)[stream_id] = cancel_event

    async def resolve_key():
        try:
            return await _secrets(request).get("text")
        except KeyringUnavailable:
            return None

    api_key = await resolve_key()
    corr = getattr(request.state, "corr_id", "")
    runtime_dir = session.runtime_dir
    streams = _streams(request)

    async def gen():
        yield "retry: 100000\n\n"
        yield "event: meta\ndata: " + json.dumps({"streamId": stream_id, "pagesEntered": []}) + "\n\n"
        try:
            async for ev in stream_chat(cfg, runtime_dir, context_id, question, page, scope, api_key, corr, cancel_event):
                yield "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
                if ev.get("event") in ("done", "error", "cancelled"):
                    break
        finally:
            streams.pop(stream_id, None)

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/ai/chat/cancel")
async def ai_chat_cancel(body: dict, request: Request) -> dict:
    stream_id = body.get("streamId", "")
    ev = _streams(request).get(stream_id)
    if ev is not None:
        ev.set()
        return {"streamId": stream_id, "status": "cancelling"}
    return {"streamId": stream_id, "status": "not_found"}


def _scope(body: dict):
    s = body.get("scope")
    if isinstance(s, dict) and "from" in s:
        return (int(s["from"]), int(s.get("to", 1_000_000)))
    return None
