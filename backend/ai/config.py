"""KI-Konfigurations-Lebenszyklus (Step 6, Spec 5.2).

Das Backend haelt die Konfiguration einmal im Startup geladen im Speicher; die API ist der einzige
Aenderungsweg. Kein Re-Read von Platte pro KI-Aufruf (vermeidet I/O, halbgeschriebene Dateien und
spaete Validierungsfehler). PUT wendet atomar an, schreibt die Datei SELBST (temp, fsync, rename —
Einzelwriter wie beim Log) und liefert die *effektive* Konfiguration zurueck. API-Schluessel sind
NIE Teil dieses Objekts (sie laufen ueber ihren eigenen Endpunkt ins Keyring).

Laufende Anfragen behalten die Konfiguration, mit der sie gestartet wurden (sie halten ein Snapshot-
Objekt); eine Base-URL-Aenderung wirkt ab der naechsten Anfrage.
"""
from __future__ import annotations

import json
import os
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

CONFIG_COMMENT_HEADER = (
    "// pdf-editor KI-Konfiguration. Diese Datei wird beim Start GELESEN; waehrend des laufenden\n"
    "// Betriebs ist die API die einzige Quelle der Wahrheit (PUT /config/ai). Manuelle Aenderungen\n"
    "// zur Laufzeit werden NICHT ueberwacht. API-Schluessel stehen hier nie — die liegen im Keyring.\n"
)


class TextModelCfg(BaseModel):
    baseUrl: str = ""
    model: str = ""
    contextWindow: int = 8192
    temperature: float = 0.2

    @field_validator("temperature")
    @classmethod
    def _clamp_temp(cls, v: float) -> float:
        if v < 0 or v > 2:
            raise ValueError("temperature muss zwischen 0 und 2 liegen")
        return v

    def is_configured(self) -> bool:
        return bool(self.baseUrl.strip() and self.model.strip())


class VisionModelCfg(BaseModel):
    baseUrl: str = ""
    model: str = ""
    enabled: bool = False

    def is_configured(self) -> bool:
        return self.enabled and bool(self.baseUrl.strip() and self.model.strip())


class DoclingCfg(BaseModel):
    # available ist NICHT benutzerveraenderlich; das Backend fuellt ihn per Feature-Detection.
    available: bool = False
    ocrEnabled: bool = True
    ocrLanguages: List[str] = Field(default_factory=lambda: ["deu", "eng"])
    tableStructure: bool = True


class PrivacyCfg(BaseModel):
    logPrompts: bool = False
    confirmBeforeSend: bool = True
    maxPagesPerRequest: int = 50


class AiConfig(BaseModel):
    textModel: Optional[TextModelCfg] = None
    visionModel: Optional[VisionModelCfg] = None
    docling: DoclingCfg = Field(default_factory=DoclingCfg)
    privacy: PrivacyCfg = Field(default_factory=PrivacyCfg)

    def text_configured(self) -> bool:
        return bool(self.textModel and self.textModel.is_configured())

    def vision_configured(self) -> bool:
        return bool(self.visionModel and self.visionModel.is_configured())

    def as_client_view(self) -> dict:
        """Sicht fuer das UI: effektive Konfiguration, docling.available gefuellt, ohne Schluessel."""
        return {
            "textModel": self.textModel.model_dump() if self.textModel else None,
            "visionModel": self.visionModel.model_dump() if self.visionModel else None,
            "docling": self.docling.model_dump(),
            "privacy": self.privacy.model_dump(),
            "textConfigured": self.text_configured(),
            "visionConfigured": self.vision_configured(),
        }


def config_dir() -> str:
    override = os.environ.get("PDF_EDITOR_CONFIG_DIR")
    if override:
        return override
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, "pdf-editor")


def config_path() -> str:
    return os.path.join(config_dir(), "ai.json")


def _strip_comment_header(raw: str) -> str:
    lines = [ln for ln in raw.splitlines() if not ln.lstrip().startswith("//")]
    return "\n".join(lines).strip()


class AiConfigStore:
    """In-Memory-Store mit Versionszaehler und atomarem Einzelwriter."""

    def __init__(self, docling_detector=None) -> None:
        self._docling_detector = docling_detector
        self._config = AiConfig()
        self.version = 0

    def load(self) -> AiConfig:
        try:
            with open(config_path(), "r", encoding="utf-8") as fh:
                raw = fh.read()
            data = json.loads(_strip_comment_header(raw)) if raw.strip() else {}
            self._config = AiConfig.model_validate(data)
        except FileNotFoundError:
            self._config = AiConfig()
        except (json.JSONDecodeError, ValueError) as exc:
            # beschadigte Datei: mit Default weiter, aber Fehler signalisieren (UI zeigt Toast).
            raise ConfigInvalid(f"ai.json ungueltig: {type(exc).__name__}") from exc
        self._refresh_docling()
        return self._config

    def snapshot(self) -> AiConfig:
        # Laufende Anfragen halten dieses (unveraenderliche) Snapshot-Objekt.
        return self._config.model_copy(deep=True)

    def get(self) -> AiConfig:
        return self._config

    def apply(self, new: AiConfig) -> AiConfig:
        # docling.available nie aus Client-Eingabe uebernehmen — immer aus Feature-Detection.
        new = new.model_copy(deep=True)
        self._refresh_docling_into(new)
        self._config = new
        self.version += 1
        self._persist()
        return self._config

    def set_docling_available(self, available: bool) -> None:
        self._config.docling.available = available

    def _refresh_docling(self) -> None:
        self._refresh_docling_into(self._config)

    def _refresh_docling_into(self, cfg: AiConfig) -> None:
        if self._docling_detector is not None:
            try:
                cfg.docling.available = bool(self._docling_detector())
            except Exception:
                cfg.docling.available = False

    def _persist(self) -> None:
        os.makedirs(config_dir(), mode=0o700, exist_ok=True)
        body = CONFIG_COMMENT_HEADER + json.dumps(self._config.model_dump(), ensure_ascii=False, indent=2)
        path = config_path()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(body)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


class ConfigInvalid(RuntimeError):
    pass
