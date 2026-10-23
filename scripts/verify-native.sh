#!/bin/sh
# Author: Ethan. Reproducible local native boundary sanitizer/property checks.
set -eu

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  printf '%s\n' 'Native qualification supports only macOS arm64.' >&2
  exit 2
fi

repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cc=${CC:-clang}
python=${PYTHON:-python3}
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/aag-native.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM

printf 'Compiler: '
"$cc" --version | sed -n '1p'
printf 'Python: '
"$python" --version

"$cc" \
  -std=c11 -Wall -Wextra -Werror -O1 -g -fno-omit-frame-pointer \
  -fsanitize=address,undefined \
  "$repo/native/safe-fs.c" -o "$build_dir/safe-fs"

ASAN_OPTIONS=abort_on_error=1 \
UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
  "$python" "$repo/tests/native/verify_native.py" "$build_dir/safe-fs"
