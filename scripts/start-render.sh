#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-10000}"

(cd /srv/lustpress && PORT=3001 bun run start) &
lustpress_pid=$!
node /srv/liszt/src/server.js &
liszt_pid=$!

stop() {
  kill "$lustpress_pid" "$liszt_pid" 2>/dev/null || true
  wait "$lustpress_pid" "$liszt_pid" 2>/dev/null || true
}
trap stop EXIT INT TERM

wait -n "$lustpress_pid" "$liszt_pid"
exit $?
