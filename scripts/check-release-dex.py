"""Inspect class definitions in the packaged DEX, not string-pool references."""
import re
import struct
import sys
from pathlib import Path
from zipfile import ZipFile


def class_members(data):
    def words(offset, count):
        return struct.unpack_from(f"<{count}I", data, offset)

    def varint(offset):
        value = 0
        for shift in range(0, 35, 7):
            byte = data[offset]
            offset += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, offset
        raise ValueError("Malformed DEX integer")

    _, strings, _, types, _, protos, _, fields, _, methods, count, classes = words(56, 12)

    def string(index):
        _, start = varint(words(strings + index * 4, 1)[0])
        return data[start:data.index(0, start)].decode("utf-8", errors="replace")

    def typename(index):
        return string(words(types + index * 4, 1)[0])

    for index in range(count):
        owner, _, _, _, _, _, cursor, _ = words(classes + index * 32, 8)
        name = typename(owner)
        if not cursor or not name.startswith(("Lwork/itzme/ploom/", "Lgo/", "Lio/nekohasekai/libbox/")):
            continue
        sizes = []
        members = {}
        for _ in range(4):
            size, cursor = varint(cursor)
            sizes.append(size)
        for group, size in enumerate(sizes):
            member = 0
            for _ in range(size):
                diff, cursor = varint(cursor)
                member += diff
                access, cursor = varint(cursor)
                is_method = group >= 2
                table = methods if is_method else fields
                _, kind, label = struct.unpack_from("<HHI", data, table + 8 * member)
                if is_method:
                    _, cursor = varint(cursor)
                    _, result, args = words(protos + kind * 12, 3)
                    argc = words(args, 1)[0] if args else 0
                    params = struct.unpack_from(f"<{argc}H", data, args + 4) if argc else ()
                    signature = "(" + "".join(map(typename, params)) + ")" + typename(result)
                else:
                    signature = typename(kind)
                members[string(label), signature] = access
        yield name, members


def verify(apk):
    classes = {}
    with ZipFile(apk) as archive:
        for filename in archive.namelist():
            if re.fullmatch(r"classes\d*\.dex", filename):
                classes.update(class_members(archive.read(filename)))
    prefix = "Lwork/itzme/ploom/"
    service = classes.get(prefix + "PloomVpnService;", {})
    for field in [("state", "Ljava/lang/String;"), ("networkType", "Ljava/lang/String;"), ("metrics", "()[J")]:
        if service.get(field, 0) & 9 != 9:
            raise ValueError(f"Missing public static {field} in packaged PloomVpnService")
    source = (Path(__file__).resolve().parents[1] / "apps/client/android/AndroidUpdateAdapter.kt").read_text()
    callbacks = re.findall(r"@(?:[\w.]+\.)?(?:Command|ActivityCallback|PermissionCallback)\s+fun (\w+)", source)
    adapter = classes.get(prefix + "AndroidUpdateAdapter;", {})
    public = {name for (name, _), access in adapter.items() if access & 1}
    if not callbacks or set(callbacks) - public:
        raise ValueError(f"Missing plugin entry points: {set(callbacks) - public}")
    for dto, expected in {
        "ExportArgs": {"name", "text"}, "BrowserArgs": {"expected"},
        "InstallArgs": {"expected", "progress"}, "TunnelArgs": {"config", "localEndpoint"},
    }.items():
        actual = {name for name, signature in classes.get(prefix + dto + ";", {})
                  if not signature.startswith("(")}
        if not expected <= actual:
            raise ValueError(f"Missing invoke argument fields in {dto}: {expected - actual}")
    for key in ("Lgo/Seq;", "Lio/nekohasekai/libbox/Libbox;"):
        if key not in classes:
            raise ValueError(f"Missing JNI class {key}")
    print("Signed APK contains the VPN reflection members, plugin callbacks and JNI entry classes")


if __name__ == "__main__":
    verify(sys.argv[1])
