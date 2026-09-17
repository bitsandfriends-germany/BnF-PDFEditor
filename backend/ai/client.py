"""OpenAI-kompatibler Client (Text + Vision), Step 6, Spec 5.1/5.5.

Zeigt gegen jede konfigurierbare, OpenAI-kompatible Base-URL (Ollama/vLLM/LM Studio/... gleichwertig).
Alle Aufrufe laufen im Backend. Fehler werden in konkrete, handelbare Codes/Texte uebersetzt
(Timeout, 401, Modell nicht gefunden, Kontext-UEberlauf, unerreichbar) — nie ein generisches "KI-Fehler".

Verifiziert gegen das installierte `openai` (moderner Client): `AsyncOpenAI(base_url=..., api_key=...)`,
`chat.completions.create(model, messages, temperature, max_tokens, stream=True)`, `models.list()`,
Chunk.delta.content, Fehlerklassen APITimeoutError/AuthenticationError/NotFoundError/APIConnectionError/BadRequestError.
"""
from __future__ import annotations

import time
from typing import AsyncIterator, List, Optional
from urllib.parse import urlparse

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    NotFoundError,
)


class AiError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def host_of(base_url: str) -> str:  # noqa: E302
    try:
        netloc = urlparse(base_url).netloc
        return netloc or base_url
    except Exception:
        return base_url


def is_local(base_url: str) -> bool:
    try:
        host = (urlparse(base_url).hostname or "").lower()
    except Exception:
        return False
    return host in ("localhost", "127.0.0.1", "::1", "[::1]")


# Test-Hook: ermoglicht es, einen (z. B. per respx gemockten) httpx.AsyncClient zu injizieren,
# ohne die Produktionspfade zu aendern. Default None -> der SDK baut seinen eigenen Client.
_HTTP_CLIENT_FACTORY = None


def build_client(base_url: str, api_key: Optional[str], timeout: float = 60.0, max_retries: int = 0) -> AsyncOpenAI:
    kwargs = dict(base_url=base_url, api_key=api_key or "unused", timeout=timeout, max_retries=max_retries)
    if _HTTP_CLIENT_FACTORY is not None:
        kwargs["http_client"] = _HTTP_CLIENT_FACTORY()
    return AsyncOpenAI(**kwargs)


def _map_error(exc: Exception, model: str, base_url: str) -> AiError:
    host = host_of(base_url)
    if isinstance(exc, APITimeoutError):
        return AiError("ai_timeout", f"Zeitueberschreitung beim Verbinden mit `{host}`.")
    if isinstance(exc, AuthenticationError):
        return AiError("ai_unauthorized", f"Zugriff auf `{host}` abgelehnt (401) — API-Schluessel pruefen.")
    if isinstance(exc, NotFoundError):
        return AiError(
            "ai_model_not_found",
            f"Modell `{model}` auf `{host}` nicht gefunden — verfuegbare Modelle im Dropdown pruefen.",
        )
    if isinstance(exc, BadRequestError):
        msg = str(exc).lower()
        if any(k in msg for k in ("context", "maximum context", "too long", "length")):
            return AiError("ai_context_overflow", "Kontextfenster ueberschritten — Seitenanzahl reduzieren.")
        return AiError("ai_bad_request", f"Ungueltige Anfrage an `{host}`.")
    if isinstance(exc, APIConnectionError):
        return AiError("ai_unreachable", f"`{host}` nicht erreichbar (DNS/Verbindung abgelehnt).")
    if isinstance(exc, APIStatusError):
        return AiError("ai_status_error", f"`{host}` meldete HTTP {exc.status_code}.")
    return AiError("ai_unknown", f"Unerwarteter Fehler gegen `{host}`.")


async def list_models(base_url: str, api_key: Optional[str], timeout: float = 10.0) -> dict:
    t0 = time.monotonic()
    client = build_client(base_url, api_key, timeout=timeout)
    try:
        resp = await client.models.list()
        models = sorted(getattr(m, "id", None) for m in resp.data if getattr(m, "id", None))
        latency = round((time.monotonic() - t0) * 1000)
        return {"ok": True, "models": models, "latencyMs": latency, "host": host_of(base_url)}
    except Exception as exc:
        err = _map_error(exc, "", base_url)
        latency = round((time.monotonic() - t0) * 1000)
        return {"ok": False, "models": [], "latencyMs": latency, "host": host_of(base_url),
                "error": err.code, "message": err.message}
    finally:
        try:
            await client.close()
        except Exception:
            pass


def build_vision_message(prompt: str, image_b64: str, mime: str = "image/png") -> dict:
    return {
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
        ],
    }


async def stream_tokens(
    client: AsyncOpenAI,
    model: str,
    messages: List[dict],
    base_url: str,
    temperature: float = 0.2,
    max_tokens: Optional[int] = None,
) -> AsyncIterator[str]:
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in stream:
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            content = getattr(delta, "content", None) if delta else None
            if content:
                yield content
    except AiError:
        raise
    except Exception as exc:
        raise _map_error(exc, model, base_url) from exc


async def chat_once(
    client: AsyncOpenAI,
    model: str,
    messages: List[dict],
    base_url: str,
    temperature: float = 0.2,
    max_tokens: Optional[int] = None,
) -> str:
    try:
        resp = await client.chat.completions.create(
            model=model, messages=messages, temperature=temperature, max_tokens=max_tokens
        )
        return resp.choices[0].message.content or ""
    except AiError:
        raise
    except Exception as exc:
        raise _map_error(exc, model, base_url) from exc
