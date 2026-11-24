#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
[[ -t 0 && -z ${CI:-} ]] || { echo "Run interactively on the owner's computer."; exit 1; }
repo=$(cd "$(dirname "$0")/.." && pwd -P)
case "${1:-}" in
  --test) profile=ploom-rehearsal ;;
  "") profile=ploom-signing ;;
  *) echo "Usage: setup-signing.sh [--test]"; exit 2 ;;
esac
dir=${XDG_DATA_HOME:-$HOME/.local/share}/$profile
mkdir -p "$(dirname "$dir")"
if git -C "$(dirname "$dir")" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "Choose key storage outside any Git checkout."; exit 1; fi
case "$(realpath -m "$dir")/" in "$repo/"*) echo "Choose storage outside the checkout."; exit 1;; esac
mkdir -m 700 "$dir" || { echo "Directory exists or is unavailable. Preserve any existing keys."; exit 1; }
cd "$repo/apps/client"
keytool -genkeypair -alias ploom -keyalg RSA -keysize 4096 -validity 10000 -keystore "$dir/android.p12" -storetype PKCS12
./node_modules/.bin/tauri signer generate -w "$dir/updater.key"
echo "Store an encrypted offline backup of the directory and save passwords in your password manager."
