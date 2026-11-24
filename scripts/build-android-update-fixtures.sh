#!/usr/bin/env bash
# Called in a disposable Actions checkout, only for x86_64 debug APKs.
set -euo pipefail
: "${RUNNER_TEMP:?}"
mitmdump --set "confdir=$RUNNER_TEMP/proxy" --version
# mitmproxy creates its CA on the first server start.
mitmdump --set "confdir=$RUNNER_TEMP/proxy" --listen-host 127.0.0.1 --listen-port 18888 >"$RUNNER_TEMP/ca-init.log" 2>&1 &
pid=$!
for _ in {1..100}; do test -s "$RUNNER_TEMP/proxy/mitmproxy-ca-cert.pem" && break; sleep .1; done
kill "$pid"
debug=src-tauri/gen/android/app/src/debug
mkdir -p "$debug/res/raw" "$debug/res/xml"
cp "$RUNNER_TEMP/proxy/mitmproxy-ca-cert.pem" "$debug/res/raw/fixture_ca.pem"
echo '<network-security-config><debug-overrides><trust-anchors><certificates src="@raw/fixture_ca"/></trust-anchors></debug-overrides></network-security-config>' > "$debug/res/xml/fixture_trust.xml"
python3 - "$debug/AndroidManifest.xml" <<'PY'
from pathlib import Path
import sys, xml.etree.ElementTree as ET
p=Path(sys.argv[1])
ns="http://schemas.android.com/apk/res/android"
ET.register_namespace("android",ns)
root=ET.parse(p).getroot() if p.exists() else ET.Element("manifest")
app=root.find("application")
if app is None: app=ET.SubElement(root,"application")
app.set("{"+ns+"}networkSecurityConfig","@xml/fixture_trust")
ET.ElementTree(root).write(p)
PY
for entry in '0.1.2 base' '0.1.3 next'; do
  read -r version name <<< "$entry"
  PLOOM_UPDATER_PUBLIC_KEY=debug-fixture python3 ../../scripts/configure-release.py "$version"
  npm run tauri -- android build --debug --apk --target x86_64
  apk=$(find src-tauri/gen/android/app/build/outputs/apk -name '*debug.apk' -print -quit)
  cp "$apk" "$RUNNER_TEMP/$name.apk"
done
keytool -genkeypair -keystore "$RUNNER_TEMP/other.p12" -storepass disposable -keypass disposable -alias fixture -keyalg RSA -dname CN=Fixture
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign --ks "$RUNNER_TEMP/other.p12" --ks-pass pass:disposable --out "$RUNNER_TEMP/other.apk" "$RUNNER_TEMP/next.apk"
