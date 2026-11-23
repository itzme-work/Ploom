"""Assemble only the three test payloads and metadata in a new directory."""
import json
import os
from pathlib import Path
import shutil
import sys

source, site = map(Path, sys.argv[1:])
version = "0.1.1-test"
prefix = Path("itzme-work/Ploom/releases/download")
target = prefix / f"v{version}"
files = ["Ploom.exe", "Ploom.exe.sig", "Ploom-arm64.apk"]
for name in files:
    path = source / name
    if path.is_symlink() or not path.is_file() or not path.stat().st_size:
        raise ValueError(f"Missing release output: {name}")
host = os.environ["STAGING_HOST"]
signature = (source / files[1]).read_text().strip()
site.mkdir()
(site / target).mkdir(parents=True)
for name in files:
    shutil.copyfile(source / name, site / target / name)
(site / "releases.json").write_text(json.dumps([{
    "tag_name": f"v{version}", "draft": False, "prerelease": True, "body": "Update rehearsal"
}]))
feed = site / prefix / "beta-feed"
feed.mkdir()
(feed / "latest.json").write_text(json.dumps({
    "version": version, "platforms": {"windows-x86_64": {
        "signature": signature, "url": f"https://{host}/{target.as_posix()}/Ploom.exe"
    }}
}))
