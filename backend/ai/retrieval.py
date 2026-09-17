"""Abruf ueber Provider-Chunks (Step 6, Spec 5.4 Nr.1).

- Chunking folgt STRUKTUR, nicht festem Fenster: Bruch an Ueberschriften/Blockgrenzen, Ziel ~400–800
  Token. Jedes Chunk behaelt Seitenzahl und Bounding-Box (Voraussetzung fuer Citations-Chips).
- BM25 (rank_bm25) ueber die gecachten Chunks, berechnet auf Abruf; Tokenisation ueber DIESELBE
  tokenise()-Funktion fuer Index und Query.
- Hybrid-Assemblierung: aktuelle Seite + direkte Nachbarn immer dabei; Top-Ranks fuellen das Budget.
- Kein Embedding, keine Vektordatenbank, kein lokales Modell, keine Stoppwort-Liste, kein Stemming.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from rank_bm25 import BM25Okapi

from .tokeniser import tokenize

CHUNK_MIN_TOKENS = 400
CHUNK_MAX_TOKENS = 800


def est_tokens(text: str) -> int:
    return len(tokenize(text))


def build_chunks(elements: List[dict]) -> List[dict]:
    """Aus Kontext-Elementen (page,bbox,text,heading) struktur-getreue Chunks bauen."""
    chunks: List[dict] = []
    cur: Optional[dict] = None

    def flush() -> None:
        nonlocal cur
        if cur and cur["text"].strip():
            chunks.append(cur)
        cur = None

    for el in elements:
        if el.get("type") == "image":
            continue
        text = (el.get("text") or "").strip()
        if not text:
            continue
        page = el.get("page", 0)
        bbox = el.get("bbox")
        if cur is None:
            cur = _new_chunk(page, bbox)
            cur["text"] = text
            cur["tokens"] = est_tokens(text)
            continue
        is_heading = bool(el.get("heading"))
        # Bruch an Ueberschrift oder wenn Budget ueberschritten wuerde (aber Chunk nicht zu klein).
        if is_heading or cur["tokens"] + est_tokens(text) > CHUNK_MAX_TOKENS:
            flush()
            cur = _new_chunk(page, bbox)
            cur["text"] = text
            cur["tokens"] = est_tokens(text)
            continue
        cur["text"] += " " + text
        cur["tokens"] += est_tokens(text)
        _merge_bbox(cur, bbox)
        cur["pages"] = sorted(set(cur["pages"]) | {page})
    flush()
    return chunks


def _new_chunk(page: int, bbox) -> dict:
    return {"text": "", "page": page, "pages": [page], "bbox": list(bbox) if bbox else None, "tokens": 0}


def _merge_bbox(chunk: dict, bbox) -> None:
    if not bbox:
        return
    if chunk["bbox"] is None:
        chunk["bbox"] = list(bbox)
        return
    b = chunk["bbox"]
    chunk["bbox"] = [min(b[0], bbox[0]), min(b[1], bbox[1]), max(b[2], bbox[2]), max(b[3], bbox[3])]


class Retriever:
    def __init__(self, chunks: List[dict]) -> None:
        self._chunks = chunks
        corpus = [tokenize(c["text"]) for c in chunks]
        # rank_bm25 verträgt keine komplett leere Korpusliste.
        self._bm25 = BM25Okapi(corpus) if chunks and any(corpus) else None

    def rank(self, query: str) -> List[Tuple[int, float]]:
        if not self._chunks:
            return []
        q = tokenize(query)
        if self._bm25 is None or not q:
            return [(i, 0.0) for i in range(len(self._chunks))]
        scores = self._bm25.get_scores(q)
        order = sorted(range(len(self._chunks)), key=lambda i: float(scores[i]), reverse=True)
        return [(i, float(scores[i])) for i in order]


def assemble(
    question: str,
    chunks: List[dict],
    current_page: Optional[int],
    token_budget: int,
) -> Tuple[List[dict], List[int]]:
    """Hybrid-Auswahl: aktuelle Seite ± Nachbar immer, dann Top-Ranks bis zum Budget."""
    if not chunks:
        return [], []
    selected: List[dict] = []
    chosen: set[int] = set()

    if current_page is not None:
        for i, c in enumerate(chunks):
            if any(abs(p - current_page) <= 1 for p in c["pages"]):
                selected.append(c)
                chosen.add(i)

    if token_budget > 0:
        used = sum(c["tokens"] for c in selected)
        for i, _score in Retriever(chunks).rank(question):
            if used >= token_budget:
                break
            if i in chosen:
                continue
            selected.append(chunks[i])
            chosen.add(i)
            used += chunks[i]["tokens"]

    selected.sort(key=lambda c: (min(c["pages"]), c["bbox"][0] if c["bbox"] else 0))
    pages = sorted({p for c in selected for p in c["pages"]})
    return selected, pages
