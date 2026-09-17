"""R62 Nutzerbefund 332abc38: Signieren mit Karte UND eigenem Bild lieferte HTTP 500,
weil SignPkcs11Request das 'image'-Feld nicht deklarierte (Pydantic-AttributeError).
Dieser Test haelt das Schema — ohne echte Karte."""


def test_sign_pkcs11_request_hat_image_feld():
    from backend.schemas import SignPkcs11Request

    req = SignPkcs11Request(module="/x.so", slot=1, certId="02", pin="p", page=0, image="aGk=")
    assert req.image == "aGk="
    assert SignPkcs11Request(module="/x.so", slot=1, certId="02", pin="p", page=0).image is None
