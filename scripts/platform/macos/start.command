#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
cd "$PROJECT_ROOT"
export MYMOMENT_AUTOSTART=1
exec node scripts/runtime/launch-control.mjs
