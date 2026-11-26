"""Collect upstream notices for Go modules linked into the Windows executable."""
import re
import sys
from pathlib import Path

vendor, info, destination = map(Path, sys.argv[1:])
sections = []
for line in info.read_text(encoding="utf-8-sig").splitlines():
    fields = line.strip().split()
    if len(fields) < 3 or fields[0] != "dep":
        continue
    module = fields[1]
    directory = vendor / module
    files = sorted(p for p in directory.glob("*") if p.is_file() and
                   re.match(r"^(license|licence|notice|copyright|copying|patents)", p.name, re.I))
    # Go modules can be nested under their upstream project's license.
    while not files and directory.is_relative_to(vendor) and directory != vendor:
        directory = directory.parent
        if directory != vendor:
            files = sorted(p for p in directory.glob("*") if p.is_file() and
                           re.match(r"^(license|licence|notice|copyright|copying|patents)", p.name, re.I))
    if not files:
        raise ValueError(f"No upstream notice for linked module {module}")
    for path in files:
        sections.append(f"{module} {fields[2]} ({path.name})\n" + path.read_text(errors="replace"))
if not sections:
    raise ValueError("No linked modules in Windows build information")
destination.write_text("\n\n".join(sections), encoding="utf-8")
