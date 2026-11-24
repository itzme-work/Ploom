#!/usr/bin/env bash
# Called after download-artifact in the private rehearsal job.
set -euo pipefail
tools="$ANDROID_HOME/build-tools/36.0.0"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
printf '%s' "$TEST_UPDATER_PUBLIC_KEY" | base64 --decode > "$scratch/updater.pub"
first_cert=''
for ver in 0.1.0 0.1.1-test; do
  win="packages/rehearsal-$ver-Windows"
  apk="packages/rehearsal-$ver-Linux/Ploom-arm64.apk"
  base64 --decode "$win/Ploom.exe.sig" > "$scratch/update.minisig"
  minisign -Vm "$win/Ploom.exe" -p "$scratch/updater.pub" -x "$scratch/update.minisig"
  python3 - "$scratch/update.minisig" "$ver" <<'PY'
from pathlib import Path
import sys
comment = Path(sys.argv[1]).read_text().splitlines()[2]
if ("version:" + sys.argv[2]) not in comment.split("\t"):
    sys.exit("Verified signature has unexpected signed version")
PY
  "$tools/apksigner" verify --print-certs "$apk" > "$scratch/cert"
  cert=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$scratch/cert")
  [[ "$cert" =~ ^[0-9a-fA-F]{64}$ ]]
  [[ -z "$first_cert" || "$cert" == "$first_cert" ]]
  first_cert=$cert
  code=100
  if [[ "$ver" == 0.1.1-test ]]; then code=101; fi
  manifest=$("$tools/aapt" dump badging "$apk")
  grep -Fq "package: name='work.itzme.ploom' versionCode='$code' versionName='$ver'" <<< "$manifest"
  "$tools/zipalign" -c -P 16 4 "$apk"
  python3 scripts/check-arm64.py "$apk"
done
