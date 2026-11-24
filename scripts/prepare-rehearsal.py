"""Configure a disposable, clean checkout for an isolated signed update rehearsal."""
import argparse
import json
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("version", choices=["0.1.0", "0.1.1-test"])
parser.add_argument("host", help="Owner-controlled staging HTTPS hostname")
args = parser.parse_args()
host = args.host.lower()
if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", host):
    parser.error("Expected a DNS hostname without path, credentials or port")
if host in ("github.com", "api.github.com") or host.endswith(".githubusercontent.com"):
    parser.error("Use a dedicated staging host")
base = Path(__file__).resolve().parents[1]
if subprocess.check_output(["git", "status", "--porcelain"], cwd=base).strip():
    parser.error("Use a fresh disposable checkout")
app = base / "apps/client"
def replace(path, old, new):
    data = path.read_text()
    if old not in data:
        raise ValueError(f"Missing template in {path}")
    path.write_text(data.replace(old, new))

conf = app / "src-tauri/tauri.conf.json"
cfg = json.loads(conf.read_text())
assert cfg["identifier"] == "work.itzme.ploom"
cfg["version"] = args.version
cfg["bundle"]["createUpdaterArtifacts"] = True
cfg["app"]["security"]["csp"] = cfg["app"]["security"]["csp"].replace("https://api.github.com", f"https://{host}")
cfg["bundle"]["android"] = {"versionCode": 100 if args.version == "0.1.0" else 101}
conf.write_text(json.dumps(cfg, indent=2))
replace(app / "src/releases.ts", "https://api.github.com/repos/itzme-work/Ploom/releases", f"https://{host}/releases.json")
for src in [app / "src-tauri/src/windows.rs", app / "android/AndroidUpdateAdapter.kt"]:
    replace(src, "github.com", host)
    replace(src, "release-assets.githubusercontent.com", host)
replace(app / "src-tauri/Cargo.toml", 'version = "0.1.0"', f'version = "{args.version}"')
print(f"Prepared {args.version} for https://{host}; keep this checkout out of production.")
