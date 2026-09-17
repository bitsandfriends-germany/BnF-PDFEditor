"""Dokument-Kontext-Schicht (Step 5). Provider-Auswahl und Orchestrierung via ContextService."""
from .base import CONTEXT_PROTOCOL_VERSION, DocumentContextProvider, sha256_file
from .basic import BasicProvider
from .docling import DoclingProvider
from .service import ContextService, DoclingUnavailable

__all__ = [
    "CONTEXT_PROTOCOL_VERSION",
    "DocumentContextProvider",
    "BasicProvider",
    "DoclingProvider",
    "ContextService",
    "DoclingUnavailable",
    "sha256_file",
]
