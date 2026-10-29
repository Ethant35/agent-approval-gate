#!/bin/bash
# Author: Ethan. Run isolated native lifecycle scenarios against a fresh app bundle.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 APP_EXECUTABLE NEW_EVIDENCE_DIRECTORY" >&2
  exit 2
fi

app="$1"
evidence="$2"
if [[ "$app" != /* || ! -x "$app" ]]; then
  echo "App executable must be an absolute executable path." >&2
  exit 2
fi
if [[ "$evidence" != /* || -e "$evidence" ]]; then
  echo "Evidence directory must be an absolute new path." >&2
  exit 2
fi
parent="$(dirname "$evidence")"
if [[ ! -d "$parent" ]]; then
  echo "Evidence directory parent must already exist." >&2
  exit 2
fi
mkdir "$evidence"

for scenario in command-q window-close; do
  log="$evidence/$scenario.log"
  test_root="$(mktemp -d "${TMPDIR:-/private/tmp}/aag-native-lifecycle.XXXXXX")"
  rmdir "$test_root"
  if ! python3 - "$app" "$log" "$scenario" "$test_root" <<'PY'
import os
import signal
import subprocess
import sys

app, log_path, scenario, test_root = sys.argv[1:]
with open(log_path, "wb") as log:
    process = subprocess.Popen(
        [app, "--self-test", "--test-root", test_root,
         "--self-test-exit", scenario],
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        status = process.wait(timeout=60)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise SystemExit("Native lifecycle scenario timed out: " + scenario)
    if status:
        raise SystemExit("Native lifecycle scenario exited with status " + str(status))
PY
  then
    rm -rf "$test_root"
    exit 1
  fi
  if [[ "$(grep -xc 'AAG_SELF_TEST_OK' "$log")" -ne 1 ]]; then
    echo "Native lifecycle scenario failed: $scenario" >&2
    rm -rf "$test_root"
    exit 1
  fi
  screenshot="$test_root/self-test-dashboard.png"
  if [[ ! -s "$screenshot" ]]; then
    echo "Native lifecycle screenshot is missing: $scenario" >&2
    rm -rf "$test_root"
    exit 1
  fi
  cp "$screenshot" "$evidence/$scenario-dashboard.png"
  rm -rf "$test_root"
done

echo "NATIVE_LIFECYCLE_OK"
