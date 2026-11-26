"""Preserve the exact npm distributions and original notices used by the frontend."""
import base64
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

destination = Path(sys.argv[1])
packages = json.loads(Path("package-lock.json").read_text())["packages"]
for path, entry in packages.items():
    if not path or entry.get("dev"):
        continue
    url = entry["resolved"]
    if urlsplit(url).scheme != "https" or urlsplit(url).netloc != "registry.npmjs.org":
        raise ValueError("Unexpected npm origin")
    algorithm, expected = entry["integrity"].split("-", 1)
    if algorithm != "sha512":
        raise ValueError("Missing SHA-512 in lockfile")
    digest = base64.b64decode(expected, validate=True)
    target = destination / (digest.hex() + ".tgz")
    if not target.exists():
        subprocess.run(["curl", "--fail", "--silent", "--show-error", "--retry", "3",
                        "--max-time", "90", "--proto", "=https", "-o", str(target), url], check=True)
    if hashlib.sha512(target.read_bytes()).digest() != digest:
        raise ValueError(f"Integrity failure for {path}")
