#!/bin/sh

DB_PATH="${DB_PATH:-/data/aozora.db}"

# Start server immediately so Railway healthcheck passes right away.
# /health does not touch the DB; search/stats have try-catch for missing DB.
node dist/index.js &
SERVER_PID=$!

if [ ! -f "$DB_PATH" ]; then
  echo "DB not found. Building search index (this may take ~25 min for full catalog)..."
  LIMIT_ARG=""
  if [ -n "$BUILD_LIMIT" ]; then
    LIMIT_ARG="--limit $BUILD_LIMIT"
  fi
  DB_PATH="$DB_PATH" DATA_DIR="$(dirname "$DB_PATH")" npx tsx scripts/build-index.ts $LIMIT_ARG \
    || echo "WARNING: Index build failed or incomplete"
  echo "Index build complete."
fi

# Keep container alive
wait $SERVER_PID
