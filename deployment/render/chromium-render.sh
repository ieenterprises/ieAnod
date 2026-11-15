#!/bin/sh
exec /usr/bin/chromium --disable-dev-shm-usage --no-sandbox "$@" 2>/dev/null
