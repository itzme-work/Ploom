#!/usr/bin/env bash
# Run from the Ploom checkout in a clean Linux builder with Go, JDK 17 and NDK.
set -euo pipefail
: "${ANDROID_NDK_HOME:?}" "${ANDROID_HOME:?}"
dest=$(realpath -m "${1:?output directory}")
mkdir -p "$dest"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
revision=c005f35300ce76427dc285481ec5695f5b179cd2
archive="$dest/sing-box-1.14.4-src.tar.gz"
curl --fail --location --proto '=https' --proto-redir '=https' "https://codeload.github.com/SagerNet/sing-box/tar.gz/$revision" -o "$archive"
echo "1c4d2b3bf261a8d98e1b026be0bbcddbcb3f53bbca77eb15e8f25f7d4e602e59  $archive" | sha256sum -c -
tar -xzf "$archive" --strip-components=1 -C "$work"
cd "$work"
export GOBIN="$work/bin"
export PATH="$GOBIN:$PATH"
go install github.com/sagernet/gomobile/cmd/gomobile@v0.1.13
go install github.com/sagernet/gomobile/cmd/gobind@v0.1.13
go mod download
go mod verify
gomobile bind -target android/arm64 -androidapi 24 -javapkg=io.nekohasekai -libname=box \
  -trimpath -tags with_quic,with_wireguard,with_utls,with_gvisor,badlinkname,tfogo_checklinkname0 \
  -ldflags '-checklinkname=0 -X github.com/sagernet/sing-box/constant.Version=1.14.4' \
  -o "$dest/libbox.aar" ./experimental/libbox
unzip -p "$dest/libbox.aar" jni/arm64-v8a/libbox.so > "$work/libbox.so"
test -s "$work/libbox.so"
go version -m "$work/libbox.so" > "$dest/libbox-buildinfo.txt"
go mod vendor -o "$work/corresponding/vendor"
tar -czf "$dest/libbox-vendor.tar.gz" -C "$work/corresponding" vendor
(cd "$dest" && sha256sum libbox.aar *tar.gz > SHA256SUMS)
