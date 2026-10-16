#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["shazamio==0.8.1"]
# ///
"""Local companion for the findSong.app extension.

POST /identify with raw audio bytes -> {"ok": true, "title", "artist", "url"}.
Same pipeline as identify-song.py: ffmpeg -> 16 kHz mono WAV -> Shazam.
Listens on localhost only. Sends an audio fingerprint to Shazam.
"""

import argparse
import asyncio
import json
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from shazamio import Shazam

MAX_BYTES = 20 * 1024 * 1024


async def recognize(data: bytes) -> dict:
    with tempfile.TemporaryDirectory(prefix="findsong-app-") as directory:
        src, wav = Path(directory) / "in.bin", Path(directory) / "audio.wav"
        src.write_bytes(data)
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", str(src),
             "-vn", "-t", "60", "-ac", "1", "-ar", "16000", str(wav)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode:
            return {"ok": False, "error": result.stderr.strip() or "Audio extraction failed"}
        response = await asyncio.wait_for(Shazam().recognize(str(wav)), timeout=90)
    track = response.get("track")
    if not track:
        return {"ok": False, "error": "No song matched."}
    return {"ok": True, "title": track["title"], "artist": track["subtitle"], "url": track.get("url")}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        self._send(200, {"ok": True, "service": "findsong-app"})

    def do_POST(self) -> None:
        if self.path != "/identify":
            return self._send(404, {"ok": False, "error": "Not found"})
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= MAX_BYTES:
            return self._send(400, {"ok": False, "error": "Bad payload size"})
        try:
            self._send(200, asyncio.run(recognize(self.rfile.read(length))))
        except Exception as error:
            self._send(500, {"ok": False, "error": f"Identification failed: {error}"})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    print(f"Listening on http://127.0.0.1:{args.port}")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
