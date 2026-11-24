#!/usr/bin/env bash
set -euo pipefail
echo good > "$RUNNER_TEMP/case"
python3 ../../scripts/android-update-fixture.py > "$RUNNER_TEMP/proxy.log" 2>&1 &
pid=$!
trap 'cat "$RUNNER_TEMP/proxy.log"; kill "$pid" || true' EXIT
node e2e/android-update.mjs
