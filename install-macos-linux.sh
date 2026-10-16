#!/bin/sh
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js 22 or later, then run this installer again.' >&2
  exit 1
fi
exec node "$task_root/companion/install.mjs"
