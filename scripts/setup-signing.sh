#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
[[ -t 0 && -z ${CI:-} ]] || { echo "Run interactively on the owner's computer."; exit 1; }
repo=$(cd "$(dirname "$0")/.." && pwd -P)
dir=${XDG_DATA_HOME:-$HOME/.local/share}/ploom-signing
mkdir -p "$(dirname "$dir")"
case "$(realpath -m "$dir")/" in "$repo/"*) echo "Choose storage outside the checkout."; exit 1;; esac
mkdir -m 700 "$dir" || { echo "Directory exists or is unavailable. Preserve any existing keys."; exit 1; }
cd "$repo/apps/client"
keytool -genkeypair -alias ploom -keyalg RSA -keysize 4096 -validity 10000 -keystore "$dir/android.p12" -storetype PKCS12
./node_modules/.bin/tauri signer generate -w "$dir/updater.key"
echo "Store an encrypted offline backup of the directory and save passwords in your password manager."
