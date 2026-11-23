"""Serve the extracted private-rehearsal-site locally behind Tailscale Serve."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin in {"https://tauri.localhost", "http://tauri.localhost", "tauri://localhost"}:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

site = Path(sys.argv[1]).resolve()
if not (site / "releases.json").is_file() or any(p.is_symlink() for p in site.rglob("*")):
    sys.exit("Select the extracted rehearsal site directory")
ThreadingHTTPServer(("127.0.0.1", 8765), partial(Handler, directory=str(site))).serve_forever()
