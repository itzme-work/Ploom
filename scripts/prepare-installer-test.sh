#!/usr/bin/env bash
# These settings apply only to the disposable emulator running installer UI tests.
set -eu
api=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
if ((api >= 26)); then
    adb shell appops set work.itzme.ploom REQUEST_INSTALL_PACKAGES allow
else
    adb shell settings put secure install_non_market_apps 1
fi
