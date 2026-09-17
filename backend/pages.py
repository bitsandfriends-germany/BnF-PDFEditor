"""Seitenbereichs-Parser (SYSTEM PROMPT PART 2, Section 3).

Reine Funktion ohne I/O, ohne Abhaengigkeiten. Dieselbe Semantik wird im Renderer
gespiegelt (src/renderer/lib/pageRange.ts) fuer Live-Validierung; beide Suites werden
von derselben Konformitaetstabelle tests/pagerange.table.json getrieben.

Grammatik (Komma-getrennte Terme):
  Einzelseite      5
  Bereich          3-9
  offen            7-  (bis Ende),  -4  (ab Anfang)
  Schluesselwort   all, odd, even, last, last-N   (N >= 1)
  Negation         fuehrendes '!'  -> Komplement ueber 1..total (aufsteigend)

Regeln: 1-basiert, inklusiv, Duplikate kollabieren (Reihenfolge des ersten Auftretens
bleibt), ausserhalb des Bereichs ist ein Validierungsfehler (nie stiller Clamp)."""

from __future__ import annotations

import re

_INT_RE = re.compile(r"^\d+$")


class PageRangeError(ValueError):
    """Validierungsfehler mit einer Meldung, die den gueltigen Bereich nennt."""


def _valid_range_msg(total: int) -> str:
    return f"gueltiger Bereich 1-{total}" if total >= 1 else "Dokument enthaelt keine Seiten"


def _parse_bound(raw: str, total: int) -> int:
    """Eine explizite Zahlengrenze; ausserhalb [1,total] ist ein Fehler (kein Clamp)."""
    s = raw.strip()
    if not _INT_RE.match(s):
        raise PageRangeError(f"Ungueltige Seitenzahl '{raw.strip() or raw}'; {_valid_range_msg(total)}")
    value = int(s)
    if value < 1 or value > total:
        raise PageRangeError(f"Seite {value} liegt ausserhalb des gültigen Bereichs 1-{total}")
    return value


def _expand_term(term: str, total: int, add) -> None:
    low = term.strip().lower()

    if low == "all":
        for n in range(1, total + 1):
            add(n)
        return
    if low == "odd":
        for n in range(1, total + 1, 2):
            add(n)
        return
    if low == "even":
        for n in range(2, total + 1, 2):
            add(n)
        return
    if low == "last":
        add(total)
        return
    if low.startswith("last-"):
        nstr = low[len("last-"):]
        if not _INT_RE.match(nstr):
            raise PageRangeError(f"Ungueltiges 'last-{nstr}'; erwartet positive Zahl")
        count = int(nstr)
        if count < 1:
            raise PageRangeError(f"Ungueltiges 'last-{count}'; erwartet Zahl >= 1")
        for n in range(max(1, total - count + 1), total + 1):
            add(n)
        return

    # Numerisch oder Bereich (mit moeglichen Leerzeichen um den Bindestrich).
    if "-" in term:
        parts = term.split("-")
        if len(parts) != 2:
            raise PageRangeError(f"Ungueltiger Bereich '{term.strip()}'")
        a_raw = parts[0].strip()
        b_raw = parts[1].strip()
        if a_raw == "" and b_raw == "":
            raise PageRangeError(f"Ungueltiger Bereich '{term.strip()}'")
        start = 1 if a_raw == "" else _parse_bound(a_raw, total)
        end = total if b_raw == "" else _parse_bound(b_raw, total)
        if start > end:
            raise PageRangeError(f"Umgekehrter Bereich '{term.strip()}'; Start muss <= Ende sein")
        for n in range(start, end + 1):
            add(n)
        return

    add(_parse_bound(term, total))


def parse_page_range(expr: str, total: int) -> list[int]:
    """Zerlegt einen Seitenbereich in eine Liste 1-basierter Seitenzahlen.

    Duplikate kollabieren unter Beibehaltung der Reihenfolge des ersten Auftretens.
    Fuehrendes '!' liefert das Komplement (aufsteigend ueber 1..total).
    Leeres Ergebnis und alle Validierungsfehler werfen PageRangeError."""

    if total < 1:
        raise PageRangeError(f"Dokument enthaelt keine Seiten ({_valid_range_msg(total)})")

    s = (expr or "").strip()
    if not s:
        raise PageRangeError(f"Seitenbereich ist leer; {_valid_range_msg(total)}")

    negate = False
    if s.startswith("!"):
        negate = True
        s = s[1:].strip()
        if not s:
            raise PageRangeError(f"Seitenbereich nach '!' ist leer; {_valid_range_msg(total)}")

    order: list[int] = []
    seen: set[int] = set()

    def add(n: int) -> None:
        if n not in seen:
            seen.add(n)
            order.append(n)

    for raw_term in s.split(","):
        term = raw_term.strip()
        if not term:
            raise PageRangeError(f"Leerer Eintrag im Seitenbereich; {_valid_range_msg(total)}")
        _expand_term(term, total, add)

    result = [n for n in range(1, total + 1) if n not in seen] if negate else order

    if not result:
        raise PageRangeError(f"Der Seitenbereich ist leer; {_valid_range_msg(total)}")
    return result


def parse_page_range_set(expr: str, total: int) -> set[int]:
    """Wie parse_page_range, aber als Menge fuer Reihenfolge-unabhaengige Operationen
    (Loeschen, Rotieren). Leeres-Ergebnis/Validierungsregeln identisch."""

    return set(parse_page_range(expr, total))
