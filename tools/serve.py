#!/usr/bin/env python3
"""
Serve the website for local testing — like `python3 -m http.server`, but with HTTP Range support, which browsers need to
scrub/seek video (GitHub Pages has it; Python's built-in server doesn't).

    python3 tools/serve.py          # http://localhost:8080/
    python3 tools/serve.py 9000     # another port

Serves the folder above tools/ (the repo root), so URLs match the live site (/, /site/…).
"""
import argparse
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def send_head(self):
        if self.path in ("/", "") and not (ROOT / "index.html").exists() and (ROOT / "index_new.html").exists():
            self.send_response(302)
            self.send_header("Location", "/index_new.html")
            self.end_headers()
            return None
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        if not m:
            return super().send_head()
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2) or 0))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_error(416, "Requested Range Not Satisfiable")
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        n = getattr(self, "_remaining", None)
        if n is None:
            return super().copyfile(source, outputfile)
        while n > 0:
            chunk = source.read(min(65536, n))
            if not chunk:
                break
            outputfile.write(chunk)
            n -= len(chunk)
        self._remaining = None

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Serve the website locally (with Range support).")
    ap.add_argument("port", nargs="?", type=int, default=8080)
    ap.add_argument("--root", help="folder to serve (default: the working-copy root)")
    a = ap.parse_args()
    if a.root:
        ROOT = Path(a.root).expanduser().resolve()
    print(f"Serving {ROOT} on http://localhost:{a.port}/  (Ctrl-C to stop)")
    ThreadingHTTPServer(("", a.port), Handler).serve_forever()
