"""Loopback-only HTTPS fixture for an isolated debug emulator; serves no upstream traffic."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import ssl
import time

root = Path(os.environ["RUNNER_TEMP"])
hosts = {"api.github.com", "github.com", "release-assets.githubusercontent.com"}
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain(root / "fixture-cert.pem", root / "fixture-key.pem")

class Fixture(BaseHTTPRequestHandler):
    def do_CONNECT(self):
        host = self.path.partition(":")[0]
        if host not in hosts:
            self.send_error(403)
            return
        self.send_response_only(200)
        self.end_headers()
        with tls.wrap_socket(self.connection, server_side=True) as secure:
            self.connection = secure
            self.rfile = secure.makefile("rb")
            self.wfile = secure.makefile("wb")
            self.handle_one_request()

    def do_GET(self):
        host = self.headers.get("Host")
        if host == "github.com" and self.path == "/itzme-work/Ploom/releases/download/v0.1.3/Ploom-arm64.apk":
            self.send_response(302)
            self.send_header("Location","https://release-assets.githubusercontent.com/fixture.apk")
            self.end_headers()
            return
        if host == "api.github.com" and self.path.startswith("/repos/itzme-work/Ploom/releases?"):
            body = json.dumps([dict(tag_name="v0.1.3",draft=False,prerelease=True,body="fixture")]).encode()
            mime = "application/json"
        elif host == "release-assets.githubusercontent.com" and self.path == "/fixture.apk":
            mode = (root / "case").read_text().strip()
            if mode == "offline": return
            if mode == "slow": time.sleep(3)
            name = {"foreign":"other.apk","downgrade":"base.apk"}.get(mode,"next.apk")
            body = (root / name).read_bytes()
            if mode == "corrupt": body = body[:128]
            mime = "application/vnd.android.package-archive"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

ThreadingHTTPServer(("127.0.0.1",18888),Fixture).serve_forever()
