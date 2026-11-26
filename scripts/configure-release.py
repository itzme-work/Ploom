"""Set the release identity in an ephemeral Actions checkout."""
import json
import os
import re
import sys
from pathlib import Path

app = Path(__file__).resolve().parents[1] / "apps/client"
version = sys.argv[1]
match = re.fullmatch(r"(0|[1-9]\d?)\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})(?:-beta\.([1-9]\d?))?", version)
if not match:
    sys.exit("Expected X.Y.Z or X.Y.Z-beta.N")
major, minor, patch = map(int, match.groups()[:3])
build = int(match[4] or 99)
code = ((major * 1000 + minor) * 1000 + patch) * 100 + build
if code > 2100000000 or (match[4] and build >= 99):
    sys.exit("Version exceeds supported Android range")

config = app / "src-tauri/tauri.conf.json"
settings = json.loads(config.read_text())
if settings["identifier"] != "work.itzme.ploom":
    sys.exit("Unexpected application ID")
public_key = os.environ["PLOOM_UPDATER_PUBLIC_KEY"].strip()
if not public_key:
    sys.exit("Missing public updater key")
settings["plugins"]["updater"]["pubkey"] = public_key
settings["version"] = version
settings["bundle"]["createUpdaterArtifacts"] = True
settings["bundle"].setdefault("android", {})["versionCode"] = code
config.write_text(json.dumps(settings, indent=2))
manifest = app / "src-tauri/Cargo.toml"
text, count = re.subn(r'(?m)^version = "[^"]+"$', f'version = "{version}"', manifest.read_text(), count=1)
if count != 1:
    sys.exit("Missing Cargo package version")
manifest.write_text(text)
