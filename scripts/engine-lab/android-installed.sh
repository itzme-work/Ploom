#!/usr/bin/env bash
# Runs in the emulator runner after Android boot. Only synthetic profiles are present.
set -euo pipefail
report_failure() {
    local result=$?
    if ((result != 0)); then
        adb logcat -d -s PloomVpn:I '*:S' | tail -60 || true
        adb shell dumpsys activity services work.itzme.ploom | grep -E 'ServiceRecord|isForeground|startRequested' || true
        adb shell dumpsys connectivity | sed -n '/Current Networks:/,/Status for known UIDs:/p' | grep -oE 'InterfaceName: [[:alnum:]_-]+' || true
    fi
    return "$result"
}
trap report_failure EXIT
api=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
test "$api" = "${PLOOM_EXPECTED_API%%.*}"
if [[ "$api" == 36 ]]; then
    adb shell wm size 1920x1200
    adb shell wm density 240
fi
adb install packages/Ploom-vpn-emulator.apk
adb push packages/android-probe /data/local/tmp/ploom-test-probe
adb shell chmod 700 /data/local/tmp/ploom-test-probe
failed=0
for protocol in http shadowsocks reality; do
    adb shell pm clear work.itzme.ploom
    echo "API $api: starting $protocol"
    provider=()
    case "$protocol" in
        shadowsocks) provider=("PLOOM_SS_TEST_CORE=$RUNNER_TEMP/sing-box");;
        reality) provider=("PLOOM_REALITY_TEST_CORE=$RUNNER_TEMP/sing-box");;
    esac
    if env "${provider[@]}" timeout --kill-after=5s 180s node apps/client/e2e/android-vpn.mjs; then
        echo "API $api / $protocol: passed" >> "$GITHUB_STEP_SUMMARY"
    else
        status=$?
        echo "API $api / $protocol: failed (exit $status)" >> "$GITHUB_STEP_SUMMARY"
        failed=1
    fi
done
exit "$failed"
