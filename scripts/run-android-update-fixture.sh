#!/usr/bin/env bash
set -euo pipefail
echo good > "$RUNNER_TEMP/case"
mitmdump --listen-host 127.0.0.1 --listen-port 18888 --set connection_strategy=lazy --set "confdir=$RUNNER_TEMP/proxy" -s ../../scripts/android-update-fixture.py > "$RUNNER_TEMP/proxy.log" 2>&1 &
pid=$!
trap 'kill "$pid" || true' EXIT
node e2e/android-update.mjs
