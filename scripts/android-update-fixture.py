"""HTTPS fixture for the disposable emulator. No upstream network requests."""
from pathlib import Path
import os
from mitmproxy import http

root = Path(os.environ["RUNNER_TEMP"])
tag = "0.1.3"

def request(flow: http.HTTPFlow):
    req = flow.request
    mode = (root / "case").read_text().strip()
    def reply(code, body=b"", **headers):
        flow.response = http.Response.make(code, body, headers)
    if req.host == "api.github.com" and req.path.startswith("/repos/itzme-work/Ploom/releases?"):
        reply(200, b'[{"tag_name":"v0.1.3","draft":false,"prerelease":true,"body":"fixture"}]', **{"content-type":"application/json","access-control-allow-origin":"*"})
    elif req.host == "github.com" and req.path == f"/itzme-work/Ploom/releases/download/v{tag}/Ploom-arm64.apk":
        reply(302, location="https://release-assets.githubusercontent.com/fixture.apk")
    elif req.host == "release-assets.githubusercontent.com" and req.path == "/fixture.apk":
        if mode == "offline":
            flow.kill()
        else:
            data = (root / ("base.apk" if mode == "downgrade" else "other.apk" if mode == "foreign" else "next.apk")).read_bytes()
            if mode == "corrupt": data = data[:128]
            reply(200, data, **{"content-type":"application/vnd.android.package-archive"})
    else:
        reply(404)
