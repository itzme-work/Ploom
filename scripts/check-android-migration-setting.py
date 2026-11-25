"""Exercise a visible preference in the two installed, non-debuggable APKs."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


def shell(*args):
    return subprocess.check_output(["adb", "shell", *args], text=True, timeout=25)


def find(label, tap=False):
    for _ in range(12):
        shell("uiautomator", "dump", "/sdcard/ploom-migration.xml")
        root = ET.fromstring(shell("cat", "/sdcard/ploom-migration.xml"))
        for node in root.iter("node"):
            if label not in (node.get("text"), node.get("content-desc")):
                continue
            bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
            if len(bounds) != 4:
                continue
            if tap:
                x1, y1, x2, y2 = bounds
                shell("input", "tap", str((x1+x2)//2), str((y1+y2)//2))
            return
        time.sleep(0.5)
    raise SystemExit(f"Visible control {label!r} missing")


find("Settings", tap=True)
if sys.argv[1] == "0.1.3":
    find("Material", tap=True)
    find("ASCII", tap=True)
find("ASCII")
