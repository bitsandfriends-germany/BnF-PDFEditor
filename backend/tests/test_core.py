"""End-to-end tests for the PDF backend HTTP contract (Steps 3/4).

Every test gets a FRESH DocumentSession: the fixture below points
PDF_EDITOR_SESSION_DIR / PDF_EDITOR_SNAPSHOT_DIR at throwaway directories and builds the
TestClient INSIDE the fixture, so entering the context manager runs app startup with those
env vars already in place. tmp_path removes all directories afterwards.

Run with:
    cd "/home/iambarth/Documents/Projects/B&F PDF Editor" \
      && backend/.venv/bin/python -m pytest backend/tests/test_core.py -q
"""
from __future__ import annotations

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

os.environ["PDF_EDITOR_BACKEND_TOKEN"] = "test-token-xyz"

import pytest
from fastapi.testclient import TestClient

from backend import main
import pymupdf as fitz
import pikepdf

import backend.session

HDRS = {"X-Auth-Token": "test-token-xyz"}


# --------------------------------------------------------------------------- fixtures
@pytest.fixture
def client(tmp_path):
    """One fresh session (own runtime + snapshot dir) per test."""
    sd = tmp_path / "run"
    sd.mkdir()
    snap = tmp_path / "snap"
    snap.mkdir()
    os.environ["PDF_EDITOR_SESSION_DIR"] = str(sd)
    os.environ["PDF_EDITOR_SNAPSHOT_DIR"] = str(snap)
    os.environ["PDF_EDITOR_UNDO_TO_DISK"] = "1"
    with TestClient(main.app) as c:
        yield c


# ----------------------------------------------------------------------------- helpers
def make_pdf(path, pages=3):
    d = fitz.open()
    for _ in range(pages):
        d.new_page()
    d.save(str(path))
    d.close()


def make_encrypted_pdf(path, pw="secret"):
    """user == owner password => opens with full rights (readOnly False)."""
    plain = str(path) + ".plain.tmp"
    d = fitz.open()
    d.new_page()
    d.save(plain)
    d.close()
    pdf = pikepdf.open(plain)
    enc = pikepdf.Encryption(owner=pw, user=pw, R=6)
    pdf.save(str(path), encryption=enc)
    pdf.close()
    os.remove(plain)


def make_user_owner_pdf(path, user_pw="u", owner_pw="o"):
    """Different user/owner passwords => opening with user_pw yields a read-only session."""
    plain = str(path) + ".plain.tmp"
    d = fitz.open()
    d.new_page()
    d.save(plain)
    d.close()
    pdf = pikepdf.open(plain)
    enc = pikepdf.Encryption(owner=owner_pw, user=user_pw, R=6)
    pdf.save(str(path), encryption=enc)
    pdf.close()
    os.remove(plain)


def make_corrupt_pdf(path):
    with open(str(path), "wb") as fh:
        fh.write(b"%PDF-1.7\nthis is not a real pdf\n%%EOF\n")


def open_doc(client, path, password=None, expect=200):
    body = {"path": str(path)}
    if password is not None:
        body["password"] = password
    r = client.post("/document/open", json=body, headers=HDRS)
    assert r.status_code == expect, f"open -> {r.status_code} {r.text}"
    return r


def state(client):
    r = client.get("/document/state", headers=HDRS)
    assert r.status_code == 200, r.text
    return r.json()


def same_file(a, b):
    return os.path.realpath(str(a)) == os.path.realpath(str(b))


# ------------------------------------------------------------------------------- tests
def test_health_is_exempt_from_token(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    # Same route WITHOUT the token must still work; a protected one must not.
    assert client.get("/document/state").status_code == 401


def test_open_plain_pdf_reports_structure_and_state(client, tmp_path):
    pdf = tmp_path / "three.pdf"
    make_pdf(pdf, pages=3)

    r = client.post("/document/open", json={"path": str(pdf)}, headers=HDRS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pageCount"] == 3
    assert body["encrypted"] is False
    assert body["readOnly"] is False
    assert body["width"] > 0
    assert body["height"] > 0
    assert isinstance(body["rotation"], int)

    st = state(client)
    assert st["open"] is True
    assert st["readOnly"] is False
    assert st["dirty"] is False
    assert st["canUndo"] is False
    assert st["canRedo"] is False
    assert st["undoDepth"] == 0
    assert same_file(st["originalPath"], pdf)


def test_open_corrupt_pdf_returns_corrupt_document(client, tmp_path):
    bad = tmp_path / "bad.pdf"
    make_corrupt_pdf(bad)

    r = client.post("/document/open", json={"path": str(bad)}, headers=HDRS)
    assert r.status_code == 422, r.text
    assert r.json()["error"] == "corrupt_document"
    assert state(client)["open"] is False


def test_open_encrypted_without_password_is_rejected(client, tmp_path):
    enc = tmp_path / "enc.pdf"
    make_encrypted_pdf(enc, pw="secret")

    r = client.post("/document/open", json={"path": str(enc)}, headers=HDRS)
    assert r.status_code == 422, r.text
    assert r.json()["error"] in ("wrong_password", "password_required")
    assert state(client)["open"] is False

    wrong = client.post("/document/open", json={"path": str(enc), "password": "nope"}, headers=HDRS)
    assert wrong.status_code == 422, wrong.text
    assert wrong.json()["error"] in ("wrong_password", "password_required")


def test_open_encrypted_with_password_is_encrypted_but_writable(client, tmp_path):
    enc = tmp_path / "enc.pdf"
    make_encrypted_pdf(enc, pw="secret")

    r = open_doc(client, enc, password="secret")
    body = r.json()
    assert body["encrypted"] is True
    assert body["readOnly"] is False
    assert body["pageCount"] >= 1

    st = state(client)
    assert st["open"] is True
    assert st["encrypted"] is True
    assert st["readOnly"] is False


def test_metadata_roundtrip_marks_dirty_and_is_undoable(client, tmp_path):
    pdf = tmp_path / "meta.pdf"
    make_pdf(pdf, pages=2)
    open_doc(client, pdf)

    before = client.get("/document/metadata", headers=HDRS)
    assert before.status_code == 200
    assert set(before.json()) == {"title", "author", "subject", "keywords"}

    payload = {"title": "Rechnung 2026", "author": "B&F", "subject": "Juni", "keywords": "a,b"}
    post = client.post("/document/metadata", json=payload, headers=HDRS)
    assert post.status_code == 200, post.text
    assert post.json() == payload

    got = client.get("/document/metadata", headers=HDRS)
    assert got.status_code == 200
    assert got.json() == payload

    assert state(client)["dirty"] is True
    assert state(client)["undoDepth"] == 1

    undo = client.post("/document/undo", headers=HDRS)
    assert undo.status_code == 200, undo.text
    back = client.get("/document/metadata", headers=HDRS)
    assert back.json()["title"] != "Rechnung 2026"


def test_rotate_accumulates_and_rejects_out_of_range_page(client, tmp_path):
    pdf = tmp_path / "rot.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)

    first = client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    assert first.status_code == 200, first.text
    assert first.json() == {"index": 0, "rotation": 90}

    second = client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    assert second.status_code == 200, second.text
    assert second.json()["rotation"] == 180

    pages = client.get("/document/pages", headers=HDRS).json()["pages"]
    assert pages[0]["rotation"] == 180
    assert pages[1]["rotation"] == 0

    bad = client.post("/pages/rotate", json={"page": 99, "delta": 90}, headers=HDRS)
    assert bad.status_code == 422, bad.text
    assert bad.json()["error"] == "bad_page"


def test_delete_page_shrinks_and_last_page_is_protected(client, tmp_path):
    pdf = tmp_path / "del.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)

    r1 = client.post("/pages/delete", json={"page": 1}, headers=HDRS)
    assert r1.status_code == 200, r1.text
    assert r1.json()["pageCount"] == 2

    r2 = client.post("/pages/delete", json={"page": 0}, headers=HDRS)
    assert r2.status_code == 200, r2.text
    assert r2.json()["pageCount"] == 1

    last = client.post("/pages/delete", json={"page": 0}, headers=HDRS)
    assert last.status_code == 422, last.text
    assert last.json()["error"] == "bad_page"
    assert len(client.get("/document/pages", headers=HDRS).json()["pages"]) == 1


def test_reorder_accepts_permutation_and_rejects_invalid(client, tmp_path):
    pdf = tmp_path / "order.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)

    ok = client.post("/pages/reorder", json={"order": [2, 0, 1]}, headers=HDRS)
    assert ok.status_code == 200, ok.text
    assert ok.json()["pageCount"] == 3

    dup = client.post("/pages/reorder", json={"order": [0, 0]}, headers=HDRS)
    assert dup.status_code == 422, dup.text
    assert dup.json()["error"] == "bad_page"

    short = client.post("/pages/reorder", json={"order": [0, 1]}, headers=HDRS)
    assert short.status_code == 422, short.text
    assert short.json()["error"] == "bad_page"


def test_merge_appends_second_document(client, tmp_path):
    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    make_pdf(a, pages=3)
    make_pdf(b, pages=2)
    open_doc(client, a)

    r = client.post("/pages/merge", json={"path": str(b)}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["pageCount"] == 5
    assert r.json()["added"] == 2
    assert state(client)["dirty"] is True


def test_undo_redo_rotate_cycle_keeps_page_count(client, tmp_path):
    pdf = tmp_path / "undo.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)

    assert client.post("/pages/rotate", json={"page": 1, "delta": 90}, headers=HDRS).status_code == 200

    st = state(client)
    assert st["canUndo"] is True
    assert st["canRedo"] is False
    assert st["undoDepth"] == 1

    undo = client.post("/document/undo", headers=HDRS)
    assert undo.status_code == 200, undo.text
    assert undo.json()["canUndo"] is False
    assert undo.json()["canRedo"] is True
    assert undo.json()["undoDepth"] == 0
    assert undo.json()["pageCount"] == 3

    assert client.get("/document/pages", headers=HDRS).json()["pages"][1]["rotation"] == 0

    redo = client.post("/document/redo", headers=HDRS)
    assert redo.status_code == 200, redo.text
    assert redo.json()["canUndo"] is True
    assert redo.json()["canRedo"] is False
    assert redo.json()["undoDepth"] == 1
    assert redo.json()["pageCount"] == 3

    assert client.get("/document/pages", headers=HDRS).json()["pages"][1]["rotation"] == 90


def test_delete_then_undo_restores_original_page_count(client, tmp_path):
    pdf = tmp_path / "delundo.pdf"
    make_pdf(pdf, pages=4)
    open_doc(client, pdf)

    r = client.post("/pages/delete", json={"page": 2}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["pageCount"] == 3

    undo = client.post("/document/undo", headers=HDRS)
    assert undo.status_code == 200, undo.text
    assert undo.json()["pageCount"] == 4
    assert state(client)["undoDepth"] == 0
    assert state(client)["canRedo"] is True

    redo = client.post("/document/redo", headers=HDRS)
    assert redo.status_code == 200, redo.text
    assert redo.json()["pageCount"] == 3


def test_new_mutation_discards_redo_branch(client, tmp_path):
    pdf = tmp_path / "redo.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)

    client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    client.post("/document/undo", headers=HDRS)
    assert state(client)["canRedo"] is True

    client.post("/pages/rotate", json={"page": 2, "delta": 90}, headers=HDRS)
    st = state(client)
    assert st["canRedo"] is False
    assert st["canUndo"] is True
    assert st["undoDepth"] == 1


def test_encrypt_clears_undo_and_redo_history(client, tmp_path):
    pdf = tmp_path / "enc-target.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)

    client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    assert state(client)["undoDepth"] == 1

    r = client.post("/document/encrypt", json={"password": "pw-123"}, headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["encrypted"] is True
    assert isinstance(r.json()["algorithm"], str)
    assert r.json()["algorithm"]

    st = state(client)
    assert st["canUndo"] is False
    assert st["canRedo"] is False
    assert st["undoDepth"] == 0
    assert st["encrypted"] is True


def test_save_preserves_encryption(client, tmp_path):
    src = tmp_path / "enc-in.pdf"
    out = tmp_path / "enc-out.pdf"
    make_encrypted_pdf(src, pw="secret")
    open_doc(client, src, password="secret")

    r = client.post("/document/save", json={"path": str(out)}, headers=HDRS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["saved"] is True
    assert same_file(body["path"], out)
    assert body["encrypted"] is True
    assert os.path.isfile(str(out))

    pdf = pikepdf.open(str(out), password="secret")
    assert len(pdf.pages) >= 1
    pdf.close()

    with pytest.raises(pikepdf.PasswordError):
        pikepdf.open(str(out))


def test_save_without_path_overwrites_original(client, tmp_path):
    pdf = tmp_path / "orig.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)

    assert client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS).status_code == 200

    r = client.post("/document/save", json={}, headers=HDRS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["saved"] is True
    assert body["encrypted"] is False
    assert same_file(body["path"], pdf)

    doc = fitz.open(str(pdf))
    try:
        assert doc.load_page(0).rotation == 90
    finally:
        doc.close()


def test_save_into_unwritable_directory_is_denied(client, tmp_path):
    if not hasattr(os, "geteuid") or os.geteuid() == 0:
        pytest.skip("file permission check is meaningless for root")

    pdf = tmp_path / "saveno.pdf"
    make_pdf(pdf, pages=2)
    open_doc(client, pdf)

    locked = tmp_path / "locked"
    locked.mkdir()
    target = locked / "out.pdf"
    os.chmod(str(locked), 0o500)
    try:
        r = client.post("/document/save", json={"path": str(target)}, headers=HDRS)
        assert r.status_code == 422, r.text
        assert r.json()["error"] == "write_denied"
    finally:
        if os.path.isdir(str(locked)):
            for name in os.listdir(str(locked)):
                os.chmod(os.path.join(str(locked), name), 0o600)
                os.remove(os.path.join(str(locked), name))
            os.chmod(str(locked), 0o700)


def test_snapshot_budget_eviction_shrinks_undo_depth(client, tmp_path, monkeypatch):
    # Tiny budget => the oldest undo snapshots get evicted on every mutation.
    monkeypatch.setattr(backend.session, "budget_bytes", lambda *args, **kwargs: 1)

    pdf = tmp_path / "budget.pdf"
    make_pdf(pdf, pages=6)
    open_doc(client, pdf)

    for page in range(5):
        r = client.post("/pages/rotate", json={"page": page, "delta": 90}, headers=HDRS)
        assert r.status_code == 200, r.text

    st = state(client)
    assert 0 <= st["undoDepth"] < 5
    assert st["canUndo"] is (st["undoDepth"] > 0)
    # The document itself is untouched by eviction.
    assert st["open"] is True
    assert len(client.get("/document/pages", headers=HDRS).json()["pages"]) == 6


def test_no_document_state_open_false_and_mutations_conflict(client, tmp_path):
    st = state(client)
    assert st["open"] is False
    assert st["originalPath"] is None
    assert st["canUndo"] is False
    assert st["undoDepth"] == 0

    mutating = (
        ("/pages/rotate", {"page": 0, "delta": 90}),
        ("/pages/delete", {"page": 0}),
        ("/pages/reorder", {"order": [0]}),
        ("/pages/merge", {"path": str(tmp_path / "missing.pdf")}),
        ("/document/metadata", {"title": "t", "author": "", "subject": "", "keywords": ""}),
        ("/document/encrypt", {"password": "x"}),
        ("/document/save", {}),
        ("/document/undo", {}),
        ("/document/redo", {}),
    )
    for path, body in mutating:
        r = client.post(path, json=body, headers=HDRS)
        assert r.status_code == 409, f"{path} -> {r.status_code} {r.text}"
        assert r.json()["error"] == "no_document"

    for path in ("/document/pages", "/document/metadata"):
        g = client.get(path, headers=HDRS)
        assert g.status_code == 409, f"{path} -> {g.status_code} {g.text}"
        assert g.json()["error"] == "no_document"


def test_read_only_document_rejects_mutations(client, tmp_path):
    src = tmp_path / "userpw.pdf"
    make_user_owner_pdf(src, user_pw="u", owner_pw="o")

    r = open_doc(client, src, password="u")
    assert r.json()["readOnly"] is True
    assert r.json()["encrypted"] is True
    assert state(client)["readOnly"] is True

    rot = client.post("/pages/rotate", json={"page": 0, "delta": 90}, headers=HDRS)
    assert rot.status_code == 409, rot.text
    assert rot.json()["error"] == "read_only"

    meta = client.post(
        "/document/metadata",
        json={"title": "x", "author": "", "subject": "", "keywords": ""},
        headers=HDRS,
    )
    assert meta.status_code == 409, meta.text
    assert meta.json()["error"] == "read_only"

    save = client.post("/document/save", json={"path": str(tmp_path / "ro-out.pdf")}, headers=HDRS)
    assert save.status_code == 409, save.text
    assert save.json()["error"] == "read_only"


def test_pages_endpoint_lists_every_page(client, tmp_path):
    pdf = tmp_path / "four.pdf"
    make_pdf(pdf, pages=4)
    open_doc(client, pdf)

    r = client.get("/document/pages", headers=HDRS)
    assert r.status_code == 200, r.text
    pages = r.json()["pages"]
    assert len(pages) == 4
    assert [p["index"] for p in pages] == [0, 1, 2, 3]
    for p in pages:
        assert p["width"] > 0
        assert p["height"] > 0
        assert isinstance(p["rotation"], int)


def test_undo_is_idempotent_when_history_is_empty(client, tmp_path):
    pdf = tmp_path / "fresh.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)

    r = client.post("/document/undo", headers=HDRS)
    assert r.status_code == 200, r.text
    assert r.json()["canUndo"] is False
    assert r.json()["undoDepth"] == 0
    assert r.json()["pageCount"] == 3

    redo = client.post("/document/redo", headers=HDRS)
    assert redo.status_code == 200, redo.text
    assert redo.json()["canRedo"] is False
    assert redo.json()["canUndo"] is False
    assert redo.json()["undoDepth"] == 0


# ---------------------------------------------------------------- Step 8: Rohe Bytes fuer den Renderer
def test_document_file_serves_work_copy_bytes(client, tmp_path):
    pdf = tmp_path / "three.pdf"
    make_pdf(pdf, pages=3)
    open_doc(client, pdf)
    r = client.get("/document/file", headers=HDRS)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["cache-control"] == "no-store"
    assert r.content[:4] == b"%PDF"
    assert len(r.content) > 0


def test_document_file_requires_token(client, tmp_path):
    assert client.get("/document/file").status_code == 401


def test_document_file_without_document_is_409(client):
    r = client.get("/document/file", headers=HDRS)
    assert r.status_code == 409
    assert r.json()["error"] == "no_document"


def test_debug_versions_liefert_versionen_und_docling_flag(client):
    r = client.get("/debug/versions", headers=HDRS)
    assert r.status_code == 200
    body = r.json()
    assert body["python"]
    assert body["protocolVersion"] == "1.0"
    assert "PyMuPDF" in body["libraries"] and "fastapi" in body["libraries"]
    assert isinstance(body["doclingAvailable"], bool)


def test_debug_versions_benoetigt_token(client):
    assert client.get("/debug/versions").status_code == 401
