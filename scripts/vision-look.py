#!/usr/bin/env python3
"""UI per lokalem Vision-Modell ansehen — ohne Harness-read_image (das die Bild-
Faehigkeit der Route anhand von `input:`-Metadaten prueft).

Ruft einen OpenAI-kompatiblen Endpunkt (Default: lokales Ollama) mit einem
Screenshot als image_url auf und gibt die Beschreibung aus. Damit kann ein
Assistent die Oberflaeche auch dann pruefen, wenn das aktuelle Chat-Modell in der
Harness nicht als bildfaehig deklariert ist.

Aufruf (Backend-venv hat PIL + urllib):
    backend/.venv/bin/python scripts/vision-look.py [PNG-oder-Pfad] ["Frage"]
    backend/.venv/bin/python scripts/vision-look.py            # nimmt Debug/ui-latest.txt

Umgebungsvariablen (Optional, Defaults = lokale Setups aus this.dsh/settings.yaml):
    VISION_BASE_URL  Default http://127.0.0.1:11434/v1
    VISION_MODEL     Default qwen3.8-unsloth-mtp:q4   (muss Vision beherrschen)
    VISION_API_KEY   Default "ollama" (Ollama prueft keinen Key)
    VISION_MAX_EDGE  Default 900  (laengste Bildkante; haelt die Anfrage klein)

Hinweis Harness: Um Natives `read_image`/Vision-Subagenten zuermoeglichen, in
this.dsh/settings.yaml dem Modell `input: [text, image]` ergaenzen.
"""
import base64
import io
import json
import os
import sys
import urllib.request

from PIL import Image


def resolve_path(argv):
    if len(argv) > 1 and os.path.isfile(argv[1]):
        return argv[1]
    marker = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Debug", "ui-latest.txt")
    if os.path.isfile(marker):
        with open(marker, encoding="utf-8") as fh:
            p = fh.read().strip()
        if os.path.isfile(p):
            return p
    return None


def main():
    path = resolve_path(sys.argv)
    if not path:
        print("Kein Bild gefunden. Pfad als Argument uebergeben oder erst Debug/ui-latest.txt erzeugen (App-Neustart/Reload).", file=sys.stderr)
        return 2
    question = sys.argv[2] if len(sys.argv) > 2 else "Describe this app screenshot: layout, panels, controls, any visible text and its language."

    img = Image.open(path).convert("RGB")
    edge = int(os.environ.get("VISION_MAX_EDGE", "900"))
    img.thumbnail((edge, edge))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=82)
    data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

    base = os.environ.get("VISION_BASE_URL", "http://127.0.0.1:11434/v1").rstrip("/")
    model = os.environ.get("VISION_MODEL", "qwen3.8-unsloth-mtp:q4")
    key = os.environ.get("VISION_API_KEY", "ollama")

    payload = {
        "model": model,
        "max_tokens": 400,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": question},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]}],
    }
    req = urllib.request.Request(
        base + "/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
    )
    print(f"# {model} <- {path}", file=sys.stderr)
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.loads(r.read())
    msg = d["choices"][0]["message"]
    out = msg.get("content") or msg.get("reasoning") or ""
    print(out.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
