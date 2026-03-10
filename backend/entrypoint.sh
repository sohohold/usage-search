#!/bin/sh
set -e

DB_PATH="${DB_PATH:-/data/aozora.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "DB not found. Building search index (this may take a few minutes)..."
  LIMIT_ARG=""
  if [ -n "$BUILD_LIMIT" ]; then
    LIMIT_ARG="--limit $BUILD_LIMIT"
  fi
  DB_PATH="$DB_PATH" DATA_DIR="$(dirname "$DB_PATH")" npx tsx scripts/build-index.ts $LIMIT_ARG
  echo "Index build complete."
fi

exec node dist/index.js
