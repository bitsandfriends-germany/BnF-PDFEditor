"""Konformitaetstests fuer den Seitenbereichs-Parser (Section 3).

Treibt backend/pages.py mit derselben Konformitaetstabelle wie der Renderer-Spiegel.
Wuerde der eine Parser von der Tabelle abweichen, schlaegt dieser Test fehl.

Run:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_pagerange.py -q
"""
from __future__ import annotations

import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import pytest

from backend.pages import PageRangeError, parse_page_range, parse_page_range_set

_TABLE_PATH = os.path.join(_ROOT, "tests", "pagerange.table.json")


def _cases():
    with open(_TABLE_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)["cases"]


_CASES = _cases()
_IDS = [f"{i}:{c['expr']!r}/{c['total']}" for i, c in enumerate(_CASES)]


def test_table_present_and_shared_with_renderer():
    # Die Tabelle muss existieren und Faelle enthalten; der Renderer liest dieselbe Datei.
    assert os.path.exists(_TABLE_PATH)
    assert len(_CASES) >= 30


@pytest.mark.parametrize("case", _CASES, ids=_IDS)
def test_parse_page_range_matches_table(case):
    expr, total = case["expr"], case["total"]
    if case.get("error"):
        with pytest.raises(PageRangeError):
            parse_page_range(expr, total)
        with pytest.raises(PageRangeError):
            parse_page_range_set(expr, total)
    else:
        assert parse_page_range(expr, total) == case["pages"]


@pytest.mark.parametrize("case", _CASES, ids=_IDS)
def test_result_within_bounds_and_deduped(case):
    if case.get("error"):
        return
    pages = parse_page_range(case["expr"], case["total"])
    assert len(pages) == len(set(pages)), "Duplikate muessen kollabieren"
    assert all(1 <= p <= case["total"] for p in pages), "kein stiller Clamp ausserhalb"


def test_error_message_names_valid_range():
    # Ein Validierungsfehler muss den gueltigen Bereich nennen (Section 3: never silent clamp).
    with pytest.raises(PageRangeError) as ei:
        parse_page_range("99", 10)
    assert "1-10" in str(ei.value)


def test_set_helper_ascending_and_deduped():
    # Fuer Reihenfolge-unabhaengige Operationen (Loeschen/Rotieren): aufsteigende Menge.
    assert parse_page_range_set("5,3,5,3,1", 10) == {1, 3, 5}
