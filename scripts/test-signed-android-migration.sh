#!/usr/bin/env bash
set -euo pipefail
package=work.itzme.ploom
adb shell getprop ro.product.cpu.abilist | grep -F arm64-v8a
uid() { adb shell pm list packages -U "$package" | tr -d '\r'; }
for version in 0.1.3 0.2.0; do
  if [[ $version == 0.1.3 ]]; then
    adb install baseline/Ploom-arm64.apk
    original=$(uid)
    [[ $original == *uid:* ]]
  else
    adb install -r candidate/Ploom-arm64.apk
    [[ $(uid) == "$original" ]]
  fi
  adb shell dumpsys package "$package" > "$RUNNER_TEMP/ploom-package.txt"
  grep -F "versionName=$version" "$RUNNER_TEMP/ploom-package.txt"
  adb shell am start -W -n "$package/.MainActivity" | grep -F 'Status: ok'
  python3 scripts/check-android-migration-setting.py "$version"
done
