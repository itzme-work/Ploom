#!/usr/bin/env bash
# Compare verified-release artifacts from the two owner-authorized builds.
set -euo pipefail
base=${1:?baseline directory}
next=${2:?candidate directory}
tools=${ANDROID_BUILD_TOOLS:?Android build-tools directory}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

check_package() {
  local dir=$1 version=$2 code=$3
  "$tools/aapt" dump badging "$dir/Ploom-arm64.apk" > "$tmp/badging"
  grep '^package:' "$tmp/badging" | grep -F "name='work.itzme.ploom' versionCode='$code' versionName='$version'" >/dev/null
  jq -e --arg v "$version" --rawfile sig "$dir/Ploom.exe.sig" '
    .version == $v and (.platforms["windows-x86_64"] |
    .signature == ($sig | rtrimstr("\n")) and
    .url == ("https://github.com/itzme-work/Ploom/releases/download/v"+$v+"/Ploom.exe"))' "$dir/latest.json" >/dev/null
}

signer() {
  "$tools/apksigner" verify --print-certs "$1" > "$tmp/certs" || return 1
  sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p' "$tmp/certs" | sort
}

check_package "$base" 0.1.0 100099
check_package "$next" 0.1.1 100199
trusted=$(signer "$base/Ploom-arm64.apk")
candidate=$(signer "$next/Ploom-arm64.apk")
test -n "$trusted" && test "$candidate" = "$trusted" || exit 1
# Exercise a valid APK signed by a different test-only publisher.
keytool -genkeypair -keystore "$tmp/test.p12" -alias fixture -storepass disposable -keypass disposable -keyalg RSA -dname CN=Fixture >/dev/null 2>&1
"$tools/apksigner" sign --ks "$tmp/test.p12" --ks-pass pass:disposable --out "$tmp/other.apk" "$next/Ploom-arm64.apk"
other=$(signer "$tmp/other.apk")
test -n "$other" && test "$other" != "$trusted" || exit 1
# The positive Windows signatures are checked against the production public key by both source runs.
minisign -G -W -p "$tmp/other.pub" -s "$tmp/other.key" >/dev/null
base64 -d "$next/Ploom.exe.sig" > "$tmp/candidate.sig"
if minisign -Vm "$next/Ploom.exe" -p "$tmp/other.pub" -x "$tmp/candidate.sig"; then
  echo 'Unexpected acceptance of a different publisher' >&2
  exit 1
fi
echo 'Signed pair, version codes, feeds and foreign publisher controls checked.'
