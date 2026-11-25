"""CycloneDX inventory from the Go linker metadata in the actual Android ELF."""
import json
import sys
from pathlib import Path

directory = Path(sys.argv[1])
components = []
for line in (directory / "libbox-buildinfo.txt").read_text().splitlines():
    fields = line.strip().split()
    if len(fields) >= 3 and fields[0] in ("dep", "mod"):
        component = {"type": "library", "name": fields[1], "version": fields[2]}
        if len(fields) == 4 and fields[3].startswith("h1:"):
            component["properties"] = [{"name": "go:module-checksum", "value": fields[3]}]
        components.append(component)
    elif fields and fields[0] == "=>":
        if not components:
            raise ValueError("Unexpected Go module replacement")
        components[-1].setdefault("properties", []).append(
            {"name": "go:replacement", "value": " ".join(fields[1:])})
if not components:
    raise ValueError("The ELF contains no readable Go module inventory")
(directory / "libbox.cdx.json").write_text(json.dumps({
    "bomFormat": "CycloneDX", "specVersion": "1.5", "version": 1,
    "components": components
}, indent=2) + "\n")
