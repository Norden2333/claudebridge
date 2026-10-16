#!/bin/sh
set -eu
cd "$(dirname "$0")"
sh update-or-rollback.sh
