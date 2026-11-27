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


def control(label, *, platform=False, click=True, widget=None, checked=False):
    deadline = time.monotonic() + 45
    size = re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size"))[-1]
    width, height = map(int, size)
    nodes = []
    scrolls = 0
    while time.monotonic() < deadline:
        try:
            adb("shell", "uiautomator", "dump", "/sdcard/ploom-test.xml")
        except subprocess.CalledProcessError:
            time.sleep(0.5)
            continue
        nodes = list(ET.fromstring(adb("shell", "cat", "/sdcard/ploom-test.xml")).iter("node"))
        for node in nodes:
            if platform:
                match = (node.get("package") == "com.android.vpndialogs"
                         and node.get("resource-id") == "android:id/button1")
            else:
                match = (node.get("package") == PACKAGE and
                         label in (node.get("content-desc"), node.get("text")))
            if widget and node.get("class") != widget:
                continue
            if checked and node.get("checked") != "true" and node.get("selected") != "true":
                continue
            if match and node.get("enabled") == "true":
                x, y, right, bottom = map(int, re.findall(r"-?\d+", node.get("bounds")))
                x, y = max(0, x), max(0, y)
                right, bottom = min(width, right), min(height, bottom)
                if right <= x or bottom <= y:
                    continue
                if click:
                    adb("shell", "input", "tap", str((x + right)//2), str((y + bottom)//2))
                return
        if not platform:
            # Search below the current viewport, then back towards its top.
            start, end = (0.72, 0.35) if scrolls % 12 < 6 else (0.35, 0.72)
            adb("shell", "input", "swipe", str(width//2), str(int(height*start)),
                str(width//2), str(int(height*end)), "320")
            scrolls += 1
        time.sleep(0.3)
    # Only synthetic data is present on this disposable emulator.
    print("Visible app controls:", [(n.get("class"), n.get("text"), n.get("content-desc"),
          n.get("enabled")) for n in nodes if n.get("package") == PACKAGE], flush=True)
    raise RuntimeError(f"Missing enabled on-screen control {label}")


class Provider(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(12)
        target = self.rfile.readline(512).split()[:2]
        print("Fixture request:", target, flush=True)
        if target == [b"GET", b"/health"]:
            self.wfile.write(b"HTTP/1.0 200 OK\r\n\r\nfixture-ready\n")
            return
        if target != [b"CONNECT", b"192.0.2.90:18081"]:
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
    control("style", widget="android.view.View")
    control("ASCII")
    control("Subscriptions")
    control("Configurations")
    adb("shell", "input", "text", "http://10.0.2.2:18483")
    # Verify actual editor contents before preview. A click on the label
    # or an IME covering the next control must not silently produce an empty list.
    adb("shell", "uiautomator", "dump", "/sdcard/ploom-test.xml")
    nodes = ET.fromstring(adb("shell", "cat", "/sdcard/ploom-test.xml")).iter("node")
    if not any(n.get("class") == "android.widget.EditText" and
               n.get("text") == "http://10.0.2.2:18483" for n in nodes):
        raise RuntimeError("Fixture URI missing from the configuration editor")
    if "mInputShown=true" in adb("shell", "dumpsys", "input_method"):
        adb("shell", "input", "keyevent", "KEYCODE_BACK")
    control("Preview")
    control("Import (1)")
    control("Servers")
    control("Select")
    adb("install", "-r", "candidate/Ploom-arm64.apk")
    assert uid == adb("shell", "pm", "list", "packages", "-U", PACKAGE)
    launch()
    control("Settings")
    control("style", widget="android.view.View")
    control("ASCII", click=False, checked=True)
    adb("shell", "input", "keyevent", "KEYCODE_BACK")
    control("Home")
    with socketserver.ThreadingTCPServer(("127.0.0.1", 18483), Provider) as provider:
        threading.Thread(target=provider.serve_forever, daemon=True).start()
        check = adb("shell", "printf 'GET /health HTTP/1.0\\r\\n\\r\\n' | toybox nc -w 5 10.0.2.2 18483")
        if "fixture-ready" not in check:
            raise RuntimeError("Emulator cannot reach the controlled provider before VPN")
        control("Connect")
        control("Confirm")
        control("VPN permission", platform=True)
        control("TUN open · connectivity unverified", click=False)
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
    control("Disconnected", click=False)
    for _ in range(20):
        services = adb("shell", "dumpsys", "activity", "services", PACKAGE)
        links = adb("shell", "ls", "/sys/class/net").split()
        if not any("ServiceRecord{" in line and "PloomVpnService" in line
                   for line in services.splitlines()) and not any(re.fullmatch(r"tun\d+", link) for link in links):
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("Ploom VPN service or TUN survived disconnect")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        for args in [("shell", "ls", "/sys/class/net"), ("shell", "dumpsys", "activity", "services", PACKAGE),
                     ("logcat", "-b", "crash", "-d", "-t", "220"),
                     ("logcat", "-d", "-t", "6000", "PloomVpn:I", "AndroidRuntime:E", "Go:E", "libc:F", "*:S")]:
            result = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=30)
            print(result.stdout[:16000], result.stderr[-300:])
        raise
