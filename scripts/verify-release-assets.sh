#!/usr/bin/env bash
# Verify the two packages from deliver/ before preparing the Windows feed.
set -euo pipefail
printf %s "$PUBLIC_KEY" | base64 -d > "$RUNNER_TEMP/pub"
base64 -d deliver/Ploom.exe.sig > "$RUNNER_TEMP/signature"
minisign -Vm deliver/Ploom.exe -p "$RUNNER_TEMP/pub" -x "$RUNNER_TEMP/signature"
sed -n '3p' "$RUNNER_TEMP/signature" | tr '\t' '\n' | grep -Fx "version:$VERSION"
tools="$ANDROID_HOME/build-tools/36.0.0"
"$tools/apksigner" verify --print-certs deliver/Ploom-arm64.apk > "$RUNNER_TEMP/cert"
grep -Fxi "Signer #1 certificate SHA-256 digest: $CERT_DIGEST" "$RUNNER_TEMP/cert"
"$tools/aapt" dump badging deliver/Ploom-arm64.apk > "$RUNNER_TEMP/badging"
grep "^package: name='work.itzme.ploom' " "$RUNNER_TEMP/badging" | grep -F "versionName='$VERSION'"
for f in deliver/Ploom.exe deliver/Ploom-arm64.apk; do test "$(stat -c %s "$f")" -le 268435456; done
jq -n --arg v "$VERSION" --arg sig "$(cat deliver/Ploom.exe.sig)" \
  '{version:$v,platforms:{"windows-x86_64":{signature:$sig,url:("https://github.com/itzme-work/Ploom/releases/download/v"+$v+"/Ploom.exe")}}}' > deliver/latest.json
