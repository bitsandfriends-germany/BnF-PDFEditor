"""Pytest fuer Step 6 (KI-Gateway). Ausfuehrung (Repo-Root, Backend-venv):
    pytest backend/tests/test_ai.py -q
respx mocked den OpenAI-kompatiblen Endpunkt (Timeout/401/Kontext-UEberlauf/Streaming)."""
from __future__ import annotations

import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

import httpx  # noqa: E402
import pytest  # noqa: E402
import respx  # noqa: E402
import pymupdf as fitz  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import main  # noqa: E402
from backend.ai import client as ai_client  # noqa: E402
from backend.ai.config import AiConfig, TextModelCfg, VisionModelCfg  # noqa: E402
from backend.ai.retrieval import assemble, build_chunks  # noqa: E402
from backend.ai.secrets import SecretsManager, open_file, seal_file  # noqa: E402
from backend.ai.tokeniser import tokenize  # noqa: E402

HDRS = {"X-Auth-Token": "test-token-xyz"}
MOCK = "http://localhost:9999/v1"


@pytest.fixture
def client(tmp_path, monkeypatch):
    run = tmp_path / "run"
    run.mkdir()
    snap = tmp_path / "snap"
    snap.mkdir()
    cfgdir = tmp_path / "config"
    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(run))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(snap))
    monkeypatch.setenv("PDF_EDITOR_CONFIG_DIR", str(cfgdir))
    # deterministisch: Keyring ganz umgehen, Session-Modus nutzen
    main.app.state.secrets = SecretsManager(mode="session")
    main.app.state.ai_config._docling_detector = lambda: False
    ai_client._HTTP_CLIENT_FACTORY = None
    with TestClient(main.app) as c:
        main.app.state.ai_config.apply(AiConfig())  # Reset auf leer
        yield c
    ai_client._HTTP_CLIENT_FACTORY = None


def _mock_http():
    # unter respx gemockter Client wird dem SDK injiziert (SDK umgeht sonst den globalen respx-Patch)
    ai_client._HTTP_CLIENT_FACTORY = lambda: httpx.AsyncClient()


def _configure(client, base_url=MOCK, model="m1"):
    main.app.state.ai_config.apply(
        AiConfig(textModel=TextModelCfg(baseUrl=base_url, model=model),
                 visionModel=VisionModelCfg(baseUrl=base_url, model=model, enabled=True))
    )


def _open_doc(client, tmp_path):
    pdf = tmp_path / "d.pdf"
    d = fitz.open()
    for i in range(3):
        pg = d.new_page()
        pg.insert_text((72, 120), f"Rechnung {i} Betrag 12.500,00 EUR", fontsize=12)
    d.save(str(pdf))
    d.close()
    r = client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    assert r.status_code == 200


def _sse_chunk(text, finish=False):
    obj = {"id": "c1", "object": "chat.completion.chunk", "created": 0, "model": "m1",
           "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": "stop" if finish else None}]}
    return f"data: {json.dumps(obj)}\n\n"


# ------------------------------------------------------------------ Tokenizer
def test_tokenizer_folds_umlauts_and_keeps_numeric_tokens():
    assert tokenize("Straße Maße") == ["strasse", "masse"]
    assert tokenize("Betrag 12.500,00 EUR") == ["betrag", "12.500,00", "eur"]
    assert tokenize("Rechnung vom 2026-03-15") == ["rechnung", "vom", "2026-03-15"]
    assert tokenize("(Zahlungsziel: 30 Tage!)") == ["zahlungsziel", "30", "tage"]
    assert tokenize("DE89 3704 0044 0532 0130 00") == ["de89", "3704", "0044", "0532", "0130", "00"]


def test_tokenizer_index_query_symmetry_over_numeric_token():
    doc_text = "Rechnung Nr. 4711 vom 2026-03-15, Betrag 12.500,00 EUR"
    query = "12.500,00"
    # identische Funktion fuer Index und Query -> identische Repraesentation des numerischen Tokens
    assert query.split() == tokenize(query)
    assert tokenize(query)[0] in tokenize(doc_text)


# ------------------------------------------------------------------ Retrieval
def test_chunks_preserve_page_and_bbox():
    els = [
        {"page": 0, "type": "text", "bbox": [10, 10, 100, 20], "text": "Erster Block", "heading": True},
        {"page": 0, "type": "text", "bbox": [10, 30, 100, 40], "text": "Zweiter Block", "heading": False},
        {"page": 1, "type": "text", "bbox": [5, 10, 50, 20], "text": "Dritter Block", "heading": True},
    ]
    chunks = build_chunks(els)
    assert all(c["bbox"] and len(c["bbox"]) == 4 for c in chunks)
    assert 0 in chunks[0]["pages"] and 1 in chunks[-1]["pages"]


def test_hybrid_assembly_always_includes_current_page_neighbour():
    els = [{"page": p, "type": "text", "bbox": [0, 0, 1, 1], "text": f"Seite {p} inhaltextext " * 40} for p in range(6)]
    chunks = build_chunks(els)
    selected, pages = assemble("völlig anderes wort", chunks, current_page=3, token_budget=50)
    assert 3 in pages  # aktuelle Seite immer dabei, egal wie BM25 rankt


def test_bm25_ranks_query_match_highest():
    els = [{"page": i, "type": "text", "bbox": [0, 0, 1, 1], "text": f"neutral text {i}", "heading": True} for i in range(5)]
    els[2]["text"] = "IBAN DE89 3704 0044 0532 0130 00 wichtig"
    chunks = build_chunks(els)
    assert len(chunks) == 5  # jede Ueberschrift startet ein eigenes Chunk
    from backend.ai.retrieval import Retriever

    ranked = Retriever(chunks).rank("IBAN DE89")
    assert ranked[0][0] == 2  # der IBAN-Chunk gewinnt


# ------------------------------------------------------------------ Konfiguration
def test_config_put_persists_with_header_and_reloads(client, monkeypatch):
    r = client.put("/config/ai", json={"textModel": {"baseUrl": MOCK, "model": "m1", "contextWindow": 4096}}, headers=HDRS)
    assert r.status_code == 200
    path = os.path.join(os.environ["PDF_EDITOR_CONFIG_DIR"], "ai.json")
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    assert raw.lstrip().startswith("//")  # Kommentarheader vorhanden
    # Reload durch den Store ignoriert die Kommentarzeilen
    from backend.ai.config import AiConfigStore

    st = AiConfigStore()
    loaded = st.load()
    assert loaded.textModel.model == "m1"


def test_config_put_rejects_bad_temperature(client):
    r = client.put("/config/ai", json={"textModel": {"baseUrl": MOCK, "model": "m1", "temperature": 9}}, headers=HDRS)
    assert r.status_code == 422
    assert r.json()["error"] == "config_invalid"


def test_docling_available_is_forced_from_detection_not_client(client):
    # Client versucht docling.available=True zu setzen; Detector (False) gewinnt.
    r = client.put("/config/ai", json={"docling": {"available": True}}, headers=HDRS)
    assert r.json()["docling"]["available"] is False


# ------------------------------------------------------------------ Schluessel
def test_secrets_envelope_roundtrip():
    blob = seal_file("geheim", "sk-abc123")
    assert open_file("geheim", blob) == "sk-abc123"
    with pytest.raises(Exception):
        open_file("falsch", blob)


def test_secrets_file_mode_reencrypts_with_fresh_nonce():
    b1 = seal_file("pw", "x")
    b2 = seal_file("pw", "x")
    assert b1 != b2  # frische Salt+Nonce, nie gleiche Nonce


def test_key_status_and_put_never_echo_key(client):
    r = client.post("/config/ai/key", json={"section": "text", "key": "sk-supersecret"}, headers=HDRS)
    assert r.status_code == 200
    assert "sk-supersecret" not in r.text  # nie zurueckgegeben
    st = client.get("/config/ai/key-status", headers=HDRS).json()
    assert st["keys"]["text"]["set"] is True


def test_keyring_backend_used_when_available(client):
    class FakeKeyring:
        def __init__(self):
            self.d = {}

        def set_password(self, s, u, p):
            self.d[(s, u)] = p

        def get_password(self, s, u):
            return self.d.get((s, u))

        def delete_password(self, s, u):
            self.d.pop((s, u), None)

    fk = FakeKeyring()
    main.app.state.secrets.set_keyring_backend(fk)
    main.app.state.secrets.set_mode("keyring")
    client.post("/config/ai/key", json={"section": "text", "key": "sk-x"}, headers=HDRS)
    assert fk.d[("pdf-editor", "text")] == "sk-x"
    client.delete("/config/ai/key", params={"section": "text"}, headers=HDRS)
    assert ("pdf-editor", "text") not in fk.d


# ------------------------------------------------------------------ Client gegen respx
@respx.mock
def test_list_models_ok_and_latency():
    _mock_http()
    respx.get(f"{MOCK}/models").mock(return_value=httpx.Response(200, json={"data": [{"id": "b"}, {"id": "a"}]}))
    out = _run(ai_client.list_models(MOCK, None))
    assert out["ok"] is True and out["models"] == ["a", "b"] and "latencyMs" in out


@respx.mock
def test_list_models_unauthorized():
    _mock_http()
    respx.get(f"{MOCK}/models").mock(return_value=httpx.Response(401, json={"error": {"message": "bad"}}))
    out = _run(ai_client.list_models(MOCK, "sk"))
    assert out["ok"] is False and out["error"] == "ai_unauthorized"


def test_list_models_unreachable():
    with respx.mock:
        _mock_http()
        respx.get(f"{MOCK}/models").mock(side_effect=httpx.ConnectError("refused"))
        out = _run(ai_client.list_models(MOCK, None))
    assert out["ok"] is False and out["error"] == "ai_unreachable"


def _run(coro):
    import asyncio

    return asyncio.run(coro)


# ------------------------------------------------------------------ Chat SSE + Fehler
@respx.mock
def test_chat_streams_tokens_and_done(client, tmp_path):
    _open_doc(client, tmp_path)
    _configure(client)
    sse = _sse_chunk("Hal") + _sse_chunk("lo") + _sse_chunk("", finish=True) + "data: [DONE]\n\n"
    respx.post(f"{MOCK}/chat/completions").mock(
        return_value=httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})
    )
    _mock_http()
    with client.stream("POST", "/ai/chat", json={"question": "Hallo?", "contextId": None}, headers=HDRS) as r:
        assert r.status_code == 200
        body = b"".join(r.iter_bytes()).decode()
    assert "Hal" in body and "lo" in body and '"done"' in body


@respx.mock
def test_chat_401_yields_error_event(client, tmp_path):
    _open_doc(client, tmp_path)
    _configure(client)
    respx.post(f"{MOCK}/chat/completions").mock(return_value=httpx.Response(401, json={"error": {"message": "no"}}))
    _mock_http()
    with client.stream("POST", "/ai/chat", json={"question": "x", "contextId": None}, headers=HDRS) as r:
        body = b"".join(r.iter_bytes()).decode()
    assert "ai_unauthorized" in body


@respx.mock
def test_chat_context_overflow_error(client, tmp_path):
    _open_doc(client, tmp_path)
    _configure(client)
    respx.post(f"{MOCK}/chat/completions").mock(
        return_value=httpx.Response(400, json={"error": {"message": "This model's maximum context length is 4096 tokens", "type": "invalid_request_error"}})
    )
    _mock_http()
    with client.stream("POST", "/ai/chat", json={"question": "x", "contextId": None}, headers=HDRS) as r:
        body = b"".join(r.iter_bytes()).decode()
    assert "ai_context_overflow" in body


def test_estimate_reports_tokens_and_local_flag(client, tmp_path):
    _open_doc(client, tmp_path)
    _configure(client, base_url="http://localhost:11434/v1")  # lokal
    r = client.post("/ai/estimate", json={"question": "Was steht hier?", "contextId": None}, headers=HDRS).json()
    assert r["estimatedInputTokens"] > 0
    assert r["nonLocal"] is False and r["requireConfirm"] is False


def test_estimate_nonlocal_requires_confirm(client, tmp_path):
    _open_doc(client, tmp_path)
    _configure(client, base_url="https://cloud.example/v1")  # nicht-lokal
    r = client.post("/ai/estimate", json={"question": "x", "contextId": None}, headers=HDRS).json()
    assert r["nonLocal"] is True and r["requireConfirm"] is True


# ------------------------------------------------------------------ Abbruch + Verbindungstest
def test_ai_chat_cancel_sets_event(client):
    import asyncio

    ev = asyncio.Event()
    main.app.state.ai_streams["sTest"] = ev
    r = client.post("/ai/chat/cancel", json={"streamId": "sTest"}, headers=HDRS).json()
    assert r["status"] == "cancelling" and ev.is_set()
    r2 = client.post("/ai/chat/cancel", json={"streamId": "nope"}, headers=HDRS).json()
    assert r2["status"] == "not_found"


@respx.mock
def test_config_test_probes_without_persisting(client):
    _mock_http()
    respx.get(f"{MOCK}/models").mock(return_value=httpx.Response(200, json={"data": [{"id": "x"}]}))
    r = client.post("/config/ai/test", json={"section": "text", "candidate": {"baseUrl": MOCK}}, headers=HDRS).json()
    assert r["ok"] is True and "x" in r["models"]
    # "testen" persistiert NICHT: Konfiguration bleibt leer.
    assert main.app.state.ai_config.get().textModel is None


def test_connection_test_reports_specific_cause(client):
    with respx.mock:
        _mock_http()
        respx.get(f"{MOCK}/models").mock(return_value=httpx.Response(401, json={"error": {"message": "no"}}))
        r = client.post("/config/ai/test", json={"section": "text", "candidate": {"baseUrl": MOCK}}, headers=HDRS).json()
    assert r["ok"] is False and r["error"] == "ai_unauthorized"


def test_ai_requires_open_document_for_chat(client):
    r = client.post("/ai/estimate", json={"question": "x"}, headers=HDRS)
    assert r.status_code == 409  # no_document (kein Dokument geoeffnet)
