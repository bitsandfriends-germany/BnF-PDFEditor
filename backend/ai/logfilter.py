"""Redaktionsfilter fuer Logs (Step 6, Spec 5.1/5.5/6).

Sicherheitsnetz: API-Schluessel und Basis-URL-Zugangsdaten duerfen NIEMALS ins Log — nicht einmal in
Stacktraces. Die Gateway-Logik schreibt ohnehin nur Metadaten; dieser Filter entfernt zusaetzlich
jeden bekannten Schluesselwert und alle Userinfo-Zugangsdaten aus URLs rekursiv aus Payloads.
"""
from __future__ import annotations

import re
from typing import Any, Iterable

# scheme://user:pass@host -> scheme://***@host
_CRED_URL = re.compile(r"([a-zA-Z][a-zA-Z0-9+.-]*://)([^/@:\s]+):([^/@\s]+)@")


def mask_url(url: str) -> str:
    if not isinstance(url, str):
        return url
    return _CRED_URL.sub(r"\1***:***@", url)


def redact(value: Any, secrets: Iterable[str] = ()) -> Any:
    """Rekursiv: unbekannte Credential-URLs maskieren, bekannte Schluesselwerte ersetzen."""
    keys = [s for s in secrets if s]
    if isinstance(value, str):
        out = mask_url(value)
        for s in keys:
            out = out.replace(s, "***")
        return out
    if isinstance(value, dict):
        return {k: redact(v, keys) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v, keys) for v in value]
    return value
