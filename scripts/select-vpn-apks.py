"""Select debug APKs by the ABI of both the native application and libbox."""
import shutil
import sys
from pathlib import Path
from zipfile import ZipFile

source, destination = map(Path, sys.argv[1:])
names = {"arm64-v8a": "Ploom-vpn-arm64-debug.apk", "x86_64": "Ploom-vpn-emulator.apk"}
selected = {}
for apk in source.rglob("*debug.apk"):
    with ZipFile(apk) as package:
        groups = {}
        for entry in package.namelist():
            parts = entry.split("/")
            if len(parts) == 3 and parts[0] == "lib" and parts[2].endswith(".so"):
                groups.setdefault(parts[1], set()).add(parts[2])
    if len(groups) != 1:
        continue
    abi, libraries = next(iter(groups.items()))
    if abi not in names or not {"libbox.so", "libploom_lib.so"} <= libraries:
        continue
    if abi in selected:
        sys.exit(f"Multiple candidate packages for {abi}")
    selected[abi] = apk
if selected.keys() != names.keys():
    sys.exit(f"Expected native app and libbox for both targets, found {sorted(selected)}")
for abi, apk in selected.items():
    shutil.copyfile(apk, destination / names[abi])
