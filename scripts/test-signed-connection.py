"""Test two non-debuggable ARM64 APKs through Android's accessibility and VPN UI."""
import re
import secrets
import socketserver
import subprocess
import threading
import time
import xml.etree.ElementTree as ET

PACKAGE = "work.itzme.ploom"
TOKEN = secrets.token_hex(24)


def adb(*args):
    return subprocess.check_output(["adb", *args], text=True, timeout=45).strip()


def control(label, *, platform=False, click=True):
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        adb("shell", "uiautomator", "dump", "/sdcard/ploom-test.xml")
        for node in ET.fromstring(adb("shell", "cat", "/sdcard/ploom-test.xml")).iter("node"):
            if platform:
                match = (node.get("package") == "com.android.vpndialogs"
                         and node.get("resource-id") == "android:id/button1")
            else:
                match = (node.get("package") == PACKAGE and
                         label in (node.get("content-desc"), node.get("text")))
            if match:
                x, y, right, bottom = map(int, re.findall(r'\d+', node.get("bounds")))
                if click:
                    adb("shell", "input", "tap", str((x + right)//2), str((y + bottom)//2))
                return
        time.sleep(0.3)
    raise RuntimeError(f"Missing visible control {label}")


class Provider(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(12)
        if self.rfile.readline(512).split()[:2] != [b"CONNECT", b"192.0.2.90:18081"]:
            return
        for _ in range(32):
            if self.rfile.readline(2048) == b"\r\n":
                break
        else:
            return
        self.wfile.write(b"HTTP/1.1 200 OK\r\n\r\n")
        if self.rfile.readline(256).strip() == TOKEN.encode():
            self.wfile.write(("received-" + TOKEN + "\n").encode())


def launch():
    adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")


def main():
    if "arm64-v8a" not in adb("shell", "getprop", "ro.product.cpu.abilist").split(","):
        raise RuntimeError("Emulator cannot execute release ARM64 APK")
    adb("install", "baseline/Ploom-arm64.apk")
    uid = adb("shell", "pm", "list", "packages", "-U", PACKAGE)
    assert "uid:" in uid
    launch()
    control("Settings")
    control("Material")
    control("ASCII")
    control("Subscriptions")
    control("Configurations")
    adb("shell", "input", "text", "http://10.0.2.2:18483")
    control("Preview")
    control("Import (1)")
    control("Servers")
    control("Select")
    adb("install", "-r", "candidate/Ploom-arm64.apk")
    assert uid == adb("shell", "pm", "list", "packages", "-U", PACKAGE)
    launch()
    control("Settings")
    control("ASCII", click=False)
    control("Home")
    control("Connect")
    control("Confirm")
    control("VPN permission", platform=True)
    with socketserver.ThreadingTCPServer(("127.0.0.1", 18483), Provider) as provider:
        threading.Thread(target=provider.serve_forever, daemon=True).start()
        for _ in range(5):
            try:
                answer = adb("shell", f"printf '%s\\n' '{TOKEN}' | toybox nc -w 5 192.0.2.90 18081")
            except subprocess.CalledProcessError:
                answer = ""
            if answer == "received-" + TOKEN:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Missing challenge response through installed VPN")
    control("Disconnect")


if __name__ == "__main__":
    main()
