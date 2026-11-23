#!/usr/bin/env bash
set -eu
apk=$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' -print -quit)
adb install -r "$apk"
adb shell am start -W -n work.itzme.ploom/.MainActivity
# UIAutomator reads accessibility nodes from the real Activity and WebView.
for attempt in $(seq 1 30); do
  adb shell uiautomator dump /sdcard/ploom-ui.xml >/dev/null
  adb pull /sdcard/ploom-ui.xml "$RUNNER_TEMP/ploom-ui.xml" >/dev/null
  if python3 - "$RUNNER_TEMP/ploom-ui.xml" <<'PY'
import sys, xml.etree.ElementTree as ET
nodes = ET.parse(sys.argv[1]).iter("node")
labels = {n.get(k) for n in nodes for k in ("text", "content-desc")}
sys.exit(0 if {"Disconnected", "Home"}.issubset(labels) else 1)
PY
  then exit 0; fi
  sleep 1
done
echo "Home screen did not appear in the Android WebView" >&2
exit 1
