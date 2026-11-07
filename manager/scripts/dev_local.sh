#!/bin/bash
# Local manager against LOCAL D1/R2 only (seed first: bash scripts/seed_local.sh).
# DEV_AUTH_EMAIL works only on localhost with CANONICAL_HOST=localhost (see worker.js whoIs).
cd "$(dirname "$0")/.."
PORT="${PORT:-8813}"
exec env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID ../node_modules/.bin/wrangler dev --local --port "$PORT" --ip 127.0.0.1 \
  --local-upstream "localhost:$PORT" --var CANONICAL_HOST:localhost --var DEV_AUTH_EMAIL:tester@local.test \
  --var LOCAL_MEDIA:1 --var "MEDIA_BASE:http://localhost:$PORT/media/" --show-interactive-dev-session=false
