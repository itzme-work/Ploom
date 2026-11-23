"""Check every packaged native library, without executing code from the APK."""
from pathlib import Path
import struct
import sys
from zipfile import ZipFile

with ZipFile(Path(sys.argv[1])) as apk:
    libs = [entry for entry in apk.infolist() if entry.filename.startswith("lib/") and entry.filename.endswith(".so")]
    if not libs:
        sys.exit("Missing native libraries")
    for entry in libs:
        data = apk.read(entry)
        if not entry.filename.startswith("lib/arm64-v8a/") or data[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", data, 18)[0] != 183:
            sys.exit(f"Expected AArch64 ELF64: {entry.filename}")
        offset = struct.unpack_from("<Q", data, 32)[0]
        size, count = struct.unpack_from("<HH", data, 54)
        loads = []
        for i in range(count):
            kind, _, fileoff, address, _, _, _, align = struct.unpack_from("<II6Q", data, offset + size*i)
            if kind == 1:
                loads.append(align >= 16384 and (address - fileoff) % 16384 == 0)
        if not loads or not all(loads):
            sys.exit(f"ELF LOAD segments incompatible with 16 KiB pages: {entry.filename}")
        print("ARM64, 16 KiB ELF alignment:", entry.filename)
