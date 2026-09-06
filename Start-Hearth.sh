#!/bin/sh
cd "$(dirname "$0")"
export MYMOMENT_AUTOSTART=1
exec node scripts/runtime/launch-control.mjs
