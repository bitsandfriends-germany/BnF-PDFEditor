"""KI-Gateway (Step 6, Spec 5.1/5.3.1/5.5).

Der Gateway geht fuer Kontext NIEMALS ueber das Frontend: er liest die Provider-JSONL direkt von
Platte, baut Chunks/Retrieval im Backend und setzt den Prompt zusammen. Streaming ueber SSE, jederzeit
abbrechbar. Protokolliert werden nur Metadaten (Modell, Token, Dauer) — Prompt/Antwort nur bei
ausdruecklich aktiviertem privacy.logPrompts; API-Schluessel werden nie geloggt (Redaktionsfilter).
"""
from __future__ import annotations

import asyncio
import time
from typing import AsyncIterator, Dict, List, Optional

from backend.context.base import read_manifest, read_page_jsonl
from backend.log import emit

from . import client as ai_client
from .client import AiError, build_client, build_vision_message, is_local, stream_tokens
from .logfilter import redact
from .retrieval import assemble, build_chunks, est_tokens

SYSTEM_PROMPT = (
    "Du bist ein Dokument-Assistent. Antworte AUSSCHLIESSLICH aus dem mitgelieferten Dokumentkontext. "
    "Steht die gesuchte Information nicht im Kontext, sage das ausdruecklich und rate nicht. "
    "Belege Aussagen mit den Seitenzahlen des Kontexts in der Form [p12]."
)

_RESERVE_TOKENS = 512


def load_context_elements(runtime_dir: str, context_id: str) -> List[dict]:
    import os

    ctx_dir = os.path.join(runtime_dir, "context", context_id)
    manifest = read_manifest(ctx_dir)
    if not manifest:
        return []
    out: List[dict] = []
    for p in range(manifest.get("pageCount", 0)):
        out.extend(read_page_jsonl(ctx_dir, p))
    return out


def _format_context(chunks: List[dict]) -> str:
    parts = []
    for c in chunks:
        pages = "/".join(str(p + 1) for p in c["pages"])
        parts.append(f"[p{pages}] {c['text']}")
    return "\n\n".join(parts)


class PreparedChat:
    def __init__(self, messages, pages_used, est_input_tokens, base_url, model, host, nonlocal_host):
        self.messages = messages
        self.pages_used = pages_used
        self.est_input_tokens = est_input_tokens
        self.base_url = base_url
        self.model = model
        self.host = host
        self.nonlocal_host = nonlocal_host


def prepare_chat(
    cfg,
    runtime_dir: str,
    context_id: Optional[str],
    question: str,
    current_page: Optional[int],
    scope: Optional[tuple],
    api_key: Optional[str],
) -> PreparedChat:
    if not cfg.text_configured():
        raise AiError("ai_not_configured", "Kein Text-Modell konfiguriert — KI-Endpunkt einrichten.")
    tm = cfg.textModel
    assert tm is not None
    base_url = tm.baseUrl
    host = ai_client.host_of(base_url)

    elements = load_context_elements(runtime_dir, context_id) if context_id else []
    if scope is not None and elements:
        lo, hi = scope
        elements = [e for e in elements if lo <= e.get("page", 0) < hi]

    chunks = build_chunks(elements)
    max_pages = cfg.privacy.maxPagesPerRequest
    budget = max(0, tm.contextWindow - est_tokens(SYSTEM_PROMPT) - est_tokens(question) - _RESERVE_TOKENS)

    if not chunks:
        selected: List[dict] = []
        pages_used: List[int] = []
    else:
        total = sum(c["tokens"] for c in chunks)
        if total <= budget:
            selected = chunks
            pages_used = sorted({p for c in chunks for p in c["pages"]})
        else:
            selected, pages_used = assemble(question, chunks, current_page, budget)
    # Seitenlimit (privacy.maxPagesPerRequest) respektieren.
    if max_pages and len(pages_used) > max_pages:
        allowed = set(pages_used[:max_pages])
        selected = [c for c in selected if any(p in allowed for p in c["pages"])]
        pages_used = sorted(allowed)

    messages: List[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if selected:
        messages.append({"role": "user", "content": "Dokumentkontext:\n" + _format_context(selected)})
    messages.append({"role": "user", "content": question})

    est = est_tokens(SYSTEM_PROMPT) + sum(c["tokens"] for c in selected) + est_tokens(question)
    return PreparedChat(messages, pages_used, est, base_url, tm.model, host, not is_local(base_url))


async def stream_chat(
    cfg,
    runtime_dir: str,
    context_id: Optional[str],
    question: str,
    current_page: Optional[int],
    scope: Optional[tuple],
    api_key: Optional[str],
    corr_id: str,
    cancel_event: asyncio.Event,
) -> AsyncIterator[dict]:
    started = time.monotonic()
    prepared = prepare_chat(cfg, runtime_dir, context_id, question, current_page, scope, api_key)
    client = build_client(prepared.base_url, api_key)
    out_tokens = 0
    try:
        # Konfiguration bleibt der Start-Snapshot (cfg); Aenderungen wirken erst naechste Anfrage.
        async for tok in stream_tokens(client, prepared.model, prepared.messages, prepared.base_url, cfg.textModel.temperature):  # type: ignore[union-attr]
            if cancel_event.is_set():
                emit({"level": "info", "action": "AI_CANCELLED", "correlationId": corr_id,
                      "payload": redact({"model": prepared.model}, [api_key or ""])})
                yield {"event": "cancelled"}
                return
            out_tokens += 1
            yield {"token": tok}
        yield {"event": "done", "sources": prepared.pages_used, "pagesEntered": prepared.pages_used}
    except AiError as err:
        emit(redact(_log_payload(corr_id, prepared.model, started, "ERROR", err.code, cfg, api_key), [api_key or ""]))
        yield {"event": "error", "error": err.code, "message": err.message}
        return
    except Exception as exc:  # Netzwerk/Streaming-ueberraschung
        mapped = AiError("ai_unreachable", f"Verbindung zu `{prepared.host}` abgebrochen.")
        emit(redact(_log_payload(corr_id, prepared.model, started, "ERROR", mapped.code, cfg, api_key), [api_key or ""]))
        yield {"event": "error", "error": mapped.code, "message": mapped.message}
        return
    finally:
        try:
            await client.close()
        except Exception:
            pass
    payload = _log_payload(corr_id, prepared.model, started, "INFO", None, cfg, api_key, out_tokens)
    emit(redact(payload, [api_key or ""]))


def _log_payload(corr_id, model, started, level, error_code, cfg, api_key, out_tokens=0):
    entry = {
        "level": level,
        "action": "AI_REQUEST",
        "correlationId": corr_id,
        "payload": {
            "model": model,
            "durationMs": round((time.monotonic() - started) * 1000),
            "outputTokens": out_tokens,
        },
    }
    if error_code:
        entry["error"] = {"type": error_code}
    return entry


async def describe_vision(cfg, api_key: Optional[str], prompt: str, image_b64: str) -> str:
    if not cfg.vision_configured():
        raise AiError("vision_not_configured", "Kein Vision-Modell aktiviert.")
    vm = cfg.visionModel
    assert vm is not None
    client = build_client(vm.baseUrl, api_key)
    try:
        return await ai_client.chat_once(client, vm.model, [build_vision_message(prompt, image_b64)], vm.baseUrl)
    finally:
        try:
            await client.close()
        except Exception:
            pass
