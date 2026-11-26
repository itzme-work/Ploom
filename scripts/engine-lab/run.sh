#!/usr/bin/env bash
# CI-only. Dependencies: gh, Python 3, tar, unzip, gzip and sha256sum.
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
cd "$scratch"
gh release download v1.14.4 -R SagerNet/sing-box -p sing-box-1.14.4-linux-amd64.tar.gz
gh release download v26.11.9 -R XTLS/Xray-core -p Xray-linux-64.zip
gh release download v1.19.34 -R MetaCubeX/mihomo -p mihomo-linux-amd64-compatible-v1.19.34.gz
sha256sum -c "$root/SHA256SUMS"
tar xzf sing-box-1.14.4-linux-amd64.tar.gz --strip-components=1 sing-box-1.14.4-linux-amd64/sing-box
unzip -p Xray-linux-64.zip xray > xray
gzip -dc mihomo-linux-amd64-compatible-v1.19.34.gz > mihomo
chmod 700 xray mihomo
python3 "$root/compare.py" "$scratch"
python3 "$root/protocols.py" "$scratch/sing-box"
python3 "$root/datagrams.py" "$scratch/sing-box"
