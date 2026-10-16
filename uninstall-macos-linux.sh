#!/bin/sh
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$task_root/companion/install.mjs" --uninstall
