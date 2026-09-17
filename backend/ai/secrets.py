"""API-Schluessel-Aufbewahrung (Step 6, Spec 5.1).

Schluessel leben NIE in der Konfigurationsdatei, NIE im Store, NIE im Log und werden nie
zurueckgegeben (nicht einmal maskiert). Drei Modi:
  - keyring:  System-Keyring (SecretService/libsecret). Jeder Aufruf laeuft off dem Event-Loop mit
              2-Sekunden-Timeout; schlaegt er fehl (verrueglich/gesperrt/langsam), degradiert die App
              definiert.
  - session:  Standard-Fallback. Schluessel nur im Backend-Speicher, nie auf Platte.
  - file:     opt-in ~/.config/pdf-editor/secrets.enc (0600), AES-256-GCM; Schluessel aus einer
              Passphrase via Argon2id abgeleitet. Envelope: 1B Version, 16B Salt, 12B Nonce, Ciphertext+Tag.
              Frische Nonce/Salt bei JEDEM Schreiben, niemals unter gleichem Schluessel wiederverwendet.

Kein fest eingebetteter Anwendungs-Schluessel — das waere nur Verschleierung, nicht Verschluesselung.
"""
from __future__ import annotations

import asyncio
import os
from typing import Optional

from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import config_dir

SERVICE = "pdf-editor"
KEYRING_TIMEOUT = 2.0
_ENVELOPE_VERSION = 1
_SALT_LEN = 16
_NONCE_LEN = 12
_KEY_LEN = 32


class KeyringUnavailable(RuntimeError):
    pass


def _argon2_key(passphrase: str, salt: bytes) -> bytes:
    return hash_secret_raw(
        secret=passphrase.encode("utf-8"),
        salt=salt,
        time_cost=3,
        memory_cost=65536,
        parallelism=4,
        hash_len=_KEY_LEN,
        type=Type.ID,
    )


def seal_file(passphrase: str, plaintext: str) -> bytes:
    """Baut das Envelope: version | salt | nonce | AESGCM(passphrase, plaintext)."""
    salt = os.urandom(_SALT_LEN)
    nonce = os.urandom(_NONCE_LEN)
    key = _argon2_key(passphrase, salt)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return bytes([_ENVELOPE_VERSION]) + salt + nonce + ct


def open_file(passphrase: str, blob: bytes) -> str:
    if len(blob) < 1 + _SALT_LEN + _NONCE_LEN + 16 or blob[0] != _ENVELOPE_VERSION:
        raise ValueError("unbekanntes oder beschadigtes Schluessel-Dateiformat")
    salt = blob[1 : 1 + _SALT_LEN]
    nonce = blob[1 + _SALT_LEN : 1 + _SALT_LEN + _NONCE_LEN]
    ct = blob[1 + _SALT_LEN + _NONCE_LEN :]
    key = _argon2_key(passphrase, salt)
    return AESGCM(key).decrypt(nonce, ct, None).decode("utf-8")


class SecretsManager:
    """Faessad ueber keyring/session/file. `keyring_backend` ist testbar injizierbar."""

    def __init__(self, keyring_backend=None, mode: str = "auto") -> None:
        self._mode = mode  # auto | session | file | keyring
        self._session: dict[str, str] = {}
        self._passphrase: Optional[str] = None
        self._backend = keyring_backend
        if self._backend is None and mode in ("auto", "keyring"):
            try:
                import keyring as _kr

                self._backend = _kr
            except Exception:
                self._backend = None

    @property
    def file_path(self) -> str:
        return os.path.join(config_dir(), "secrets.enc")

    def set_mode(self, mode: str) -> None:
        self._mode = mode

    def set_passphrase(self, passphrase: str) -> None:
        self._passphrase = passphrase

    def set_keyring_backend(self, backend) -> None:
        self._backend = backend

    # ---------------- Keyring (off Event-Loop, 2s Timeout) ----------------
    async def _keyring_call(self, fn, *args):
        if self._backend is None:
            raise KeyringUnavailable("kein Keyring-Backend")
        try:
            return await asyncio.wait_for(asyncio.to_thread(fn, *args), timeout=KEYRING_TIMEOUT)
        except asyncio.TimeoutError as exc:
            raise KeyringUnavailable("Keyring-Timeout") from exc
        except Exception as exc:  # Backendfehler/gesperrt
            raise KeyringUnavailable(f"Keyring-Fehler: {type(exc).__name__}") from exc

    # ---------------- öffentliche API ----------------
    async def put(self, section: str, key: str) -> dict:
        """SPEICHERT einen Schluessel. Gibt nur Status zurueck, nie den Wert."""
        if self._mode in ("keyring", "auto") and self._backend is not None:
            try:
                await self._keyring_call(self._backend.set_password, SERVICE, section, key)
                return {"section": section, "stored": True, "source": "keyring"}
            except KeyringUnavailable:
                if self._mode == "keyring":
                    raise
                # auto -> Session-Fallback
        self._session[section] = key
        return {"section": section, "stored": True, "source": "session"}

    async def get(self, section: str) -> Optional[str]:
        if self._mode == "file":
            return self._file_get(section)
        if self._mode in ("keyring", "auto") and self._backend is not None:
            try:
                val = await self._keyring_call(self._backend.get_password, SERVICE, section)
                if val:
                    return val
                if self._mode == "keyring":
                    return None
            except KeyringUnavailable:
                if self._mode == "keyring":
                    raise
        return self._session.get(section)

    async def delete(self, section: str) -> dict:
        if self._backend is not None and self._mode in ("keyring", "auto"):
            try:
                await self._keyring_call(self._backend.delete_password, SERVICE, section)
            except Exception:
                pass
        self._session.pop(section, None)
        return {"section": section, "stored": False}

    async def status(self, sections: list[str]) -> dict:
        out = {}
        for s in sections:
            present = False
            source = None
            if self._mode == "file":
                present = s in self._file_load_all()
                source = "file" if present else None
            else:
                try:
                    if self._backend is not None and self._mode in ("keyring", "auto"):
                        v = await self._keyring_call(self._backend.get_password, SERVICE, s)
                        if v:
                            present, source = True, "keyring"
                except KeyringUnavailable:
                    pass
                if not present and s in self._session:
                    present, source = True, "session"
            out[s] = {"set": bool(present), "source": source}
        return out

    # ---------------- verschlüsselte Datei (Modus 'file') ----------------
    def _file_load_all(self) -> dict:
        if not self._passphrase:
            return {}
        try:
            with open(self.file_path, "rb") as fh:
                blob = fh.read()
        except FileNotFoundError:
            return {}
        import json

        try:
            return json.loads(open_file(self._passphrase, blob))
        except Exception:
            return {}

    def _file_get(self, section: str) -> Optional[str]:
        return self._file_load_all().get(section)

    def file_put(self, section: str, key: str) -> dict:
        if not self._passphrase:
            raise ValueError("keine Passphrase gesetzt")
        data = self._file_load_all()
        data[section] = key
        blob = seal_file(self._passphrase, __import__("json").dumps(data))
        os.makedirs(config_dir(), mode=0o700, exist_ok=True)
        tmp = self.file_path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(blob)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self.file_path)
        try:
            os.chmod(self.file_path, 0o600)
        except OSError:
            pass
        return {"section": section, "stored": True, "source": "file"}
