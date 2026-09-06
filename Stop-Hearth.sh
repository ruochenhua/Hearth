#!/bin/sh
cd "$(dirname "$0")"
exec node scripts/stop-album.mjs
