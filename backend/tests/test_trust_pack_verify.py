"""R66 Nutzerbefunde, als Backend-Regression verankert:
a) 'CA trusted: no' — die Aussteller-Kette fehlte im Dokument. Der Signierpfad
   bettet CA-Zertifikate jetzt VOR der Signatur in ein PDS/DSS-Paket ein
   (/Perms-/DocPDS); die Pruefung nutzt sie als Vertrauensanker -> trusted=True,
   OHNE dass die Integritaetspruefung kippt (intact=True).
b) 'DOCUMENT CHANGED AFTER SAVING' (Adobe) — das Signatur-Aussehen enthielt den
   Signaturwert-Wortlaut (Name/Grund/Zeit) schon VOR der Wert-Fuellung. Das
   Aussehen traegt den Text jetzt nur bei Wieder-Signatur; Neusignaturen zeigen
   Strich+Balken statt Text -> Diff-Stufe bleibt NONE.
c) 'http 500 bei falscher pin' -> saubere Klassifikation in Pkcs11Error (422).
"""
import base64
import datetime
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("PDF_EDITOR_BACKEND_TOKEN", "test-token-xyz")
HDRS = {"X-Auth-Token": "test-token-xyz"}


def _fixture():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import NameOID

    ca_k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "R66 Test Root CA")])
    now = datetime.datetime.now(datetime.UTC)
    ca_c = (x509.CertificateBuilder().subject_name(ca_n).issuer_name(ca_n)
            .public_key(ca_k.public_key()).serial_number(66001)
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=365))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(ca_k, hashes.SHA256()))
    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "R66 Tester")])
    c = (x509.CertificateBuilder().subject_name(n).issuer_name(ca_n)
         .public_key(k.public_key()).serial_number(66002)
         .not_valid_before(now - datetime.timedelta(days=1))
         .not_valid_after(now + datetime.timedelta(days=365))
         .sign(ca_k, hashes.SHA256()))
    p12 = pkcs12.serialize_key_and_certificates(b"", k, c, [ca_c],
                                                serialization.BestAvailableEncryption(b"pw"))
    ca_der = ca_c.public_bytes(serialization.Encoding.DER)
    return p12, ca_der


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(tmp_path / "s"))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(tmp_path / "sn"))
    os.makedirs(tmp_path / "s", exist_ok=True)
    os.makedirs(tmp_path / "sn", exist_ok=True)
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    import importlib

    import backend.main as m
    importlib.reload(m)
    src = tmp_path / "doc.pdf"
    import pymupdf

    d = pymupdf.open()
    p = d.new_page()
    p.insert_text((72, 120), "R66 Vertrauenspfad")
    d.save(str(src))
    d.close()
    with TestClient(m.app, raise_server_exceptions=False) as c:
        r = c.post("/document/open", json={"path": str(src)}, headers=HDRS)
        assert r.status_code == 200
        yield c


def _sign(client, p12_bytes, ca_der=None, **extra):
    p12f = tempfile.mktemp(suffix=".p12")
    with open(p12f, "wb") as fh:
        fh.write(p12_bytes)
    body = {"p12Path": p12f, "password": "pw", "page": 0,
            "x": 60, "y": 60, "width": 220, "height": 70, "name": "R66 Tester",
            "reason": "REGRESSION", **extra}
    if ca_der is not None:
        body["caCerts"] = [base64.b64encode(ca_der).decode()]
    r = client.post("/document/sign", json=body, headers=HDRS)
    os.unlink(p12f)
    assert r.status_code == 200, r.text
    return r.json()


def test_trust_pack_makes_signature_trusted_and_keeps_intact(client):
    """Beweis: mit caCerts signiert -> signatures-Lieferung meldet
    intact=True UND trusted=True (DSS-Anker); Diff-Stufe NONE."""
    p12, ca_der = _fixture()
    _sign(client, p12, ca_der=ca_der)
    v = client.get("/document/signatures", headers=HDRS).json()["signatures"][0]
    assert v["intact"] is True, f"Integritaet darf durchs Trust-Pack nicht kippen: {v}"
    assert v["valid"] is True
    assert v["trusted"] is True, f"CA-Kette im DSS muss trusted=True ergeben: {v}"
    assert v["modifiedAfterSigning"] is False


def test_signed_ap_has_no_value_text_and_diff_none(client):
    """Beweis: frische Signatur — das /N-Aussehen traegt KEIN ( ... ) Tj des
    Signaturwertes (Adobe-Befund 'document changed after saving'); die
    Diff-Stufe der Pruefung ist NONE."""
    p12, ca_der = _fixture()
    # Bild wie im echten UI-Pfad (R62/R66: Kombi-Grafik-Aussehen)
    import pymupdf

    sd = pymupdf.open()
    sp = sd.new_page(width=160, height=60)
    sp.draw_line((6, 50), (70, 12), color=(0, 0, 0.35), width=3)
    import io

    buf = io.BytesIO()
    buf.write(sd.get_page_pixmap(0, dpi=120).tobytes("png"))
    sd.close()
    img = base64.b64encode(buf.getvalue()).decode()
    _sign(client, p12, image=img)  # ohne caCerts: alt bekannter Pfad muss ebenfalls intakt bleiben
    v = client.get("/document/signatures", headers=HDRS).json()["signatures"][0]
    assert v["intact"] is True and v["valid"] is True
    assert v["modificationLevel"] == "NONE", v
    assert v.get("trustChain"), "ohne DSS-Anker erwartet der Nutzer die Ketten-Erklaerung"
    assert v.get("trustNote")
    import pymupdf

    work = os.path.join(os.environ["PDF_EDITOR_SESSION_DIR"], "work.pdf")
    d = pymupdf.open(work)
    w = next(x for x in d[0].widgets() if x.field_type_string == "Signature")
    key = d.xref_get_key(w.xref, "AP")
    assert key[0] == "dict"
    nk = d.xref_get_key(w.xref, "AP")
    import re

    m = re.search(r"/N (\d+) 0 R", nk[1])
    ap = d.xref_stream(int(m.group(1)))
    assert b") Tj" not in ap, "Wert-Wortlaut darf nicht im frischen AP stehen"
    assert b" re f" in ap or b"Do" in ap, "Grafik/Strich muss trotzdem gezeichnet sein"
    d.close()


def test_classify_pkcs11_errors():
    from backend.pkcs11_ops import Pkcs11Error, _classify_pkcs11_exc

    class PINIncorrect(Exception):
        pass

    e = _classify_pkcs11_exc(PINIncorrect(""))
    assert isinstance(e, Pkcs11Error) and "falsch" in e.message


def test_fullbleed_graphic_stays_visible_no_covering_background(tmp_path, monkeypatch):
    """R68 NUTZERBEFUND (bLogo-Datei): die Nutzergrafik war im fertigen Feld
    unsichtbar — der AP-Strom malte nach dem Bild einen DECKENDEN Hintergrund
    ueber das ganze Feld. Bewiesen wird hier an der PLATTENDATEI:
    (1) AP-Strom ohne deckendes Fuelloperator-'re f' und mit /SigArt Do,
    (2) MuPDF-Rendering des Widget-Rechtecks zeigt FARBIGE Bildpixel
        ( Fixture-Grafik ist koenigsblau — Farb-Abstand max-min > 30),
    (3) Zweitbibliothek pikepdf: Bild-XObject enthaelt dieselben farbigen
        Samples. (Nicht-Aenderung: Signatur bleibt intact/level NONE.)"""
    import base64
    import pymupdf
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    import datetime

    monkeypatch.setenv("PDF_EDITOR_SESSION_DIR", str(tmp_path / "s"))
    monkeypatch.setenv("PDF_EDITOR_SNAPSHOT_DIR", str(tmp_path / "sn"))
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from fastapi.testclient import TestClient
    import backend.main as m

    src = tmp_path / "doc.pdf"
    d = pymupdf.open()
    d.new_page()
    d.save(str(src))
    d.close()

    # Koenigsblaue Grafik mit Alpha (wie echte Logos)
    gd = pymupdf.open()
    gp = gd.new_page(width=220, height=70)
    gp.draw_rect(pymupdf.Rect(8, 8, 212, 62), color=(0.04, 0.35, 0.94),
                 fill=(0.04, 0.35, 0.94), width=2)
    gpix = gp.get_pixmap(alpha=True)
    gpng = gpix.tobytes("png")
    gd.close()

    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    n = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "R68 Sichtbar")])
    now = datetime.datetime.now(datetime.UTC)
    c = (x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key())
         .serial_number(68001).not_valid_before(now - datetime.timedelta(days=1))
         .not_valid_after(now + datetime.timedelta(days=30)).sign(k, hashes.SHA256()))
    p12f = tmp_path / "s.p12"
    p12f.write_bytes(pkcs12.serialize_key_and_certificates(b"", k, c, None,
                     serialization.BestAvailableEncryption(b"pw")))

    HDRS = {"X-Auth-Token": os.environ.get("PDF_EDITOR_BACKEND_TOKEN", "test-token-xyz")}
    os.environ.setdefault("PDF_EDITOR_BACKEND_TOKEN", "test-token-xyz")
    with TestClient(m.app, raise_server_exceptions=False) as cl:
        assert cl.post("/document/open", json={"path": str(src)}, headers=HDRS).status_code == 200
        r = cl.post("/document/sign", json={
            "p12Path": str(p12f), "password": "pw", "page": 0,
            "x": 60, "y": 60, "width": 220, "height": 70, "name": "R68 Sichtbar",
            "image": base64.b64encode(gpng).decode()}, headers=HDRS)
        assert r.status_code == 200, r.text
        v = cl.get("/document/signatures", headers=HDRS).json()["signatures"][0]
        assert v["intact"] is True and v["valid"] is True  # NICHT-Aenderung
        assert v.get("modificationLevel") == "NONE"

    # main._session_from_env nutzt PDF_EDITOR_SESSION_DIR als Runtime-Verzeichnis
    work = os.path.join(os.environ["PDF_EDITOR_SESSION_DIR"], "work.pdf")
    assert os.path.exists(work), "Work-Datei nicht im isolierten Session-Verzeichnis"
    doc = pymupdf.open(work)
    w = doc[0].first_widget
    assert w is not None
    # (1) AP-Strom: Bild zuerst, KEIN deckendes re f
    t, val = doc.xref_get_key(w.xref, "AP")
    import re
    m2 = re.search(r"/N (\d+) 0 R", val or "")
    assert m2, f"AP/N fehlt: {val}"
    data = doc.xref_stream(int(m2.group(1)))
    assert b"/SigArt Do" in data, "Bild wird nicht gezeichnet"
    assert b"re f" not in data, "deckendes Fullbleich verdeckt die Grafik (R68-Bug)"
    assert b"Do" in data.split(b"q", 2)[1] or data.index(b"Do") < data.index(b"re S"), \
        "Bild muss VOR dem Rahmen gezeichnet werden"
    # (2) Rendering des Feldes: farbige Pixel
    pix = doc[0].get_pixmap(clip=w.rect, dpi=144)
    ss, nch = pix.samples, pix.n
    colorful = sum(1 for i in range(0, len(ss), nch) if max(ss[i:i + 3]) - min(ss[i:i + 3]) > 30)
    doc.close()
    assert colorful > 5000, f"Grafik unsichtbar: nur {colorful} farbige Pixel im Feld"
    # (3) pikepdf: Samples des Bild-XObjects farbig
    import pikepdf
    with pikepdf.open(work) as pdf:
        for a in (pdf.pages[0].get("/Annots") or []):
            par = a.get("/Parent")
            if (a.get("/FT") or (par and par.get("/FT"))) == pikepdf.Name("/Sig"):
                form = (a.get("/AP") or par.get("/AP"))["/N"]
                xo = ((form.get("/Resources") or {}).get("/XObject") or {})["/SigArt"]
                s = xo.read_bytes()
                cf = sum(1 for i in range(0, len(s), 3) if max(s[i:i + 3]) - min(s[i:i + 3]) > 30)
                assert cf > 200000, "Bild-XObject selbst enthaelt keine farbigen Samples"
                break
