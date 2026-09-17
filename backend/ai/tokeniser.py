"""Einheitliche Tokenisierung (Step 6, Spec 5.4 Nr.1).

DIESELBE reine Funktion für Index UND Query — die klassische Defektquelle ist Drift zwischen beiden
Pfaden; deshalb einmal geschrieben, Unit-getestet, von beiden aufgerufen.

Regeln (exakt nach Spec):
- lowercase; Umlaute/ß falten (ä→ae, ö→oe, ü→ue, ß→ss).
- Trennung an Whitespace UND Bindestrichen — ABER Bindestriche ZWISCHEN Ziffern bleiben erhalten,
  sonst zerfällt "2026-03-15" in drei Teile (IBAN-/Rechnungsnummern/Paragraphen wären kaputt).
- Zeichen am Token-Rand werden als Interpunktion entfernt; Interpunktion INNERHALB einer
  alphanumerischen Folge (z. B. "12.500,00", "Nr.2") bleibt erhalten.
- Keine Stopword-Liste, kein Stemming (BM25-IDF regelt häufige Terme; dän/wichtiges "nicht/kein" würde
  in Verträgen zerstört).
"""
from __future__ import annotations

import re
from typing import List

_FOLD = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})
# Whitespace und Nicht-Buchstaben/Ziffern sind Trenner, AUSSER "_" bleibt; Bindestrich bleibt
# erhalten, wenn er zwischen Ziffern sitzt. Wir zerlegen in "Wortstücke": zusammenhängende Folgen aus
# alphanumerischen Zeichen plus dazwischenliegenden Interpunktion, getrennt durch Whitespace/Bindestrich.
_SPLIT = re.compile(r"[\s]+|(?<!\d)-|-(?!\d)")
# Rand-Interpunktion entfernen: führende/abschließende Nicht-Alphanumerika.
_EDGE_PUNCT = re.compile(r"^[^\w]+|[^\w]+$", re.UNICODE)


def tokenize(text: str) -> List[str]:
    if not text:
        return []
    lowered = text.lower().translate(_FOLD)
    tokens: List[str] = []
    for piece in _SPLIT.split(lowered):
        if not piece:
            continue
        trimmed = _EDGE_PUNCT.sub("", piece)
        if trimmed:
            tokens.append(trimmed)
    return tokens
