"""Smartcard-Lane: liest die ECHTE Karte, falls gesteckt (sonst sauber skipped).
Beweist uberechte HTTP-Pfade: Geraete erkennen + Signatur-Zertifikat inkl. Subjekt
oeffentlich lesen. Signieren braucht die persoenliche PIN und wird bewusst nie
automatisiert (Sperrisiko) — das uebernimmt der Nutzer in der UI."""
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("PDF_EDITOR_BACKEND_TOKEN", "test-token-xyz")
HDRS = {"X-Auth-Token": "test-token-xyz"}


@pytest.fixture()
def client():
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from backend.main import app

    with TestClient(app) as c:
        yield c


def test_real_card_certificates_readable(client):
    dev = client.get("/pkcs11/devices", headers=HDRS)
    assert dev.status_code == 200
    devices = dev.json()["devices"]
    if not devices:
        pytest.skip("keine Smartcard im Leser")
    labels = {d["label"] for d in devices}
    assert any("PIN" in l or l for l in labels)
    # Signatur-Zertifikat suchen (Label unbekannt — ueber alle Slots scannen).
    found = None
    for d in devices:
        r = client.get("/pkcs11/certificates", params={"module": d["module"], "slot": d["slot"]}, headers=HDRS)
        assert r.status_code == 200, r.text
        for c in r.json()["certificates"]:
            if c.get("hasKey") and c.get("subject"):
                found = c
                break
        if found:
            break
    assert found is not None, "kein lesbares Zertifikat"
    assert len(found["id"]) >= 2
    assert "," in found["subject"]  # CN Muster NAME,NAME,serial


def test_wrong_pin_maps_to_clean_422_not_http_500(client):
    """R66a Nutzerbefund: 'http 500 bei falscher pin'. Falsche PIN muss eine
    bedienbare 422-Meldung liefern — NIE ein HTTP-500. Getestet mit einer
    SICHEREN, ungueltigen PIN (falsche Laenge: OpenSC lehnt sie ab, OHNE den
    PIN-Zaehler der echten Karte zu verbrauchen)."""
    dev = client.get("/pkcs11/devices", headers=HDRS)
    assert dev.status_code == 200
    devices = dev.json()["devices"]
    if not devices:
        pytest.skip("keine Smartcard im Leser")
    d = devices[0]
    r = client.post("/pkcs11/verify-pin", headers=HDRS, json={
        "module": d["module"], "slot": d["slot"], "pin": "x", "sigPin": None})
    assert r.status_code == 422, f"erwartet 422, kam {r.status_code}: {r.text[:200]}"
    body = r.json()
    assert body.get("error") == "pkcs11_error"
    msg = body.get("message", "")
    assert msg and "500" not in msg and "Traceback" not in msg
    assert "x" not in msg  # PIN darf nie in der Meldung stehen


def test_classify_pkcs11_exc_matrix():
    """R66a: Die Klassifikation laeuft OHNE Karte (synthetische Fehler wie sie
    python-pkcs11/pyHanko werfen) — deckt die 500-Quelle ab: rohe pkcs11-Fehler
    durfen nie unuebersetzt bis zu FastAPI durchreichen."""
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from backend.pkcs11_ops import Pkcs11Error, _classify_pkcs11_exc

    class PINIncorrect(Exception):
        pass

    class PKCS11Error(Exception):
        pass

    class AlreadyLoggedIn(Exception):
        pass

    e = PINIncorrect("PIN is incorrect")
    c = _classify_pkcs11_exc(e)
    assert isinstance(c, Pkcs11Error) and c.status == 422
    assert "falsch" in c.message
    c = _classify_pkcs11_exc(PKCS11Error("Token is locked / CKR_PIN_LOCKED"))
    assert "gesperrt" in c.message
    c = _classify_pkcs11_exc(PKCS11Error("User interaction required (cancelled)"))
    assert "abgebrochen" in c.message
    # Leere Message: nur Klassname entscheidet (python-pkcs11 liefert teils '')
    c = _classify_pkcs11_exc(PINIncorrect(""))
    assert "falsch" in c.message
    # PIN selbst nie in der Meldung
    assert "123456" not in _classify_pkcs11_exc(PINIncorrect("bad pin 123456")).message
