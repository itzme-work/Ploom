#!/usr/bin/env bash
# Runs in the emulator runner after Android boot. Only synthetic profiles are present.
set -euo pipefail
report_failure() {
    local result=$?
    if ((result != 0)); then
        adb logcat -d -s PloomVpn:I '*:S' | tail -60 || true
        adb shell dumpsys activity services work.itzme.ploom | grep -E 'ServiceRecord|isForeground|startRequested' || true
        adb shell ip -o link show | grep -E 'tun[0-9]+:' || true
    fi
    return "$result"
}
trap report_failure EXIT
adb install packages/Ploom-vpn-emulator.apk
timeout --kill-after=5s 180s node apps/client/e2e/android-vpn.mjs
adb shell pm clear work.itzme.ploom
PLOOM_SS_TEST_CORE="$RUNNER_TEMP/sing-box" timeout --kill-after=5s 180s node apps/client/e2e/android-vpn.mjs
