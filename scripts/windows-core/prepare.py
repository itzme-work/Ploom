"""Prepare a Go source overlay and the unmodified official x64 Wintun binary."""
import hashlib
import json
import re
from pathlib import Path
import sys
from zipfile import ZipFile

def verified(data, expected):
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Unexpected source or Wintun digest")
    return data

def verify_permitted_api(source, header):
    # Each lazy procedure in the pinned Go bindings must correspond to a
    # function typedef in the header shipped with this exact driver archive.
    procedures = set()
    for binding in source.glob("*.go"):
        procedures.update(re.findall(r'modwintun\.NewProc\("([A-Za-z0-9_]+)"\)', binding.read_text()))
    if not procedures:
        raise ValueError("Wintun procedure bindings missing")
    declared = set(re.findall(rb'WINAPI\s+(WINTUN_[A-Z0-9_]+)_FUNC\b', header))
    for procedure in sorted(procedures):
        symbol = re.sub(r'(?<=[a-z])(?=[A-Z])', '_', procedure).upper().encode()
        if symbol not in declared:
            raise ValueError(f"Wintun procedure outside bundled public header: {procedure}")


def prepare(module, archive, output, engine):
    source = module / "internal/wintun"
    loader = source / "dll_windows.go"
    embedding = source / "dll_windows_amd64.go"
    verified(loader.read_bytes(), "1a332593019fe17c3d929672cd1e37236c1be88efbafe2cbdcbfcf8e3e615c36")
    original = verified(embedding.read_bytes(), "2510bebfe4eabfdbeddaeece4ed91b53d84950108af6432b8e1c39cef33d1c83")
    verified(archive.read_bytes(), "07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51")
    with ZipFile(archive) as bundle:
        verify_permitted_api(source, bundle.read("wintun/include/wintun.h"))
        dll = verified(bundle.read("wintun/bin/amd64/wintun.dll"), "e5da8447dc2c320edc0fc52fa01885c103de8c118481f683643cacc3220dafce")
    output.mkdir(exist_ok=True)
    stub = output / embedding.name
    stub.write_bytes(original.split(b"import (", 1)[0])
    overlay = {str(loader): str(Path(__file__).with_name(loader.name).resolve()), str(embedding): str(stub)}
    (output / "overlay.json").write_text(json.dumps({"Replace": overlay}), encoding="utf-8")
    (engine / "wintun.dll").write_bytes(dll)

if __name__ == "__main__":
    prepare(*(Path(arg).resolve() for arg in sys.argv[1:]))
