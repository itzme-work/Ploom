"""Collect original module notices for every Go module actually linked in libbox."""
from pathlib import Path, PurePosixPath
import json
import sys
import tarfile

out = Path(sys.argv[1])
bom = json.loads((out / "libbox.cdx.json").read_text())
modules = {c["name"]: c for c in bom["components"]}
notices = out / "third-party"
notices.mkdir(exist_ok=True)
index = {name: [] for name in modules}
with tarfile.open(out / "libbox-vendor.tar.gz") as archive:
    for entry in archive:
        if not entry.isfile():
            continue
        path = PurePosixPath(entry.name)
        if path.is_absolute() or ".." in path.parts or path.parts[0] != "vendor":
            raise ValueError("Unexpected vendor path")
        if not path.name.lower().startswith(("copying", "license", "licence", "notice", "copyright", "patents")):
            continue
        for parent in path.parents:
            key = "/".join(parent.parts[1:])
            if key in modules:
                target = notices.joinpath(*path.parts[1:])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(entry).read())
                index[key].append(str(target.relative_to(out)))
                break
index["github.com/sagernet/sing-box"] = ["LICENSES/sing-box-1.14.4.txt"]
(out / "go-notices.json").write_text(json.dumps(index, indent=2) + "\n")
missing = [name for name, files in index.items() if not files]
if missing:
    sys.exit("Missing notices: " + ", ".join(missing))
