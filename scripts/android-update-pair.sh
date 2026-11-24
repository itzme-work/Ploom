#!/usr/bin/env bash
# Run only on a clean CI emulator with ARM64 translation.
set -euo pipefail
base=packages/tested-0.1.0/Ploom-arm64.apk
next=packages/tested-0.1.1/Ploom-arm64.apk
pkg=work.itzme.ploom
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
adb shell getprop ro.product.cpu.abilist | grep -F arm64-v8a
adb install "$base"
state() {
  adb shell dumpsys package "$pkg" > "$tmp/state"
  grep -F "versionName=$1" "$tmp/state"
  grep -m1 -E 'userId=|appId=' "$tmp/state" | tr -d '\r' > "$tmp/uid"
}
state 0.1.0
cp "$tmp/uid" "$tmp/baseline-uid"
keytool -genkeypair -keystore "$tmp/test.p12" -alias fixture -storepass disposable -keypass disposable -keyalg RSA -dname CN=Fixture
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign --ks "$tmp/test.p12" --ks-pass pass:disposable --out "$tmp/other.apk" "$next"
reject() {
  if adb install -r "$1" >"$tmp/result" 2>&1; then
    echo 'Unexpected package installation' >&2
    exit 1
  fi
  grep -F "$2" "$tmp/result"
}
reject "$tmp/other.apk" INSTALL_FAILED_UPDATE_INCOMPATIBLE
state 0.1.0
adb install -r "$next"
state 0.1.1
cmp "$tmp/uid" "$tmp/baseline-uid"
reject "$base" INSTALL_FAILED_VERSION_DOWNGRADE
state 0.1.1
