#!/usr/bin/env bash
# Called in a disposable Actions checkout, only for x86_64 debug APKs.
set -euo pipefail
: "${RUNNER_TEMP:?}"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 -subj /CN=Ploom-emulator-fixture \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'subjectAltName=DNS:github.com,DNS:api.github.com,DNS:release-assets.githubusercontent.com' \
  -keyout "$RUNNER_TEMP/fixture-key.pem" -out "$RUNNER_TEMP/fixture-cert.pem" 2>/dev/null
debug=src-tauri/gen/android/app/src/debug
mkdir -p "$debug/res/raw" "$debug/res/xml"
cp "$RUNNER_TEMP/fixture-cert.pem" "$debug/res/raw/fixture_ca.pem"
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
