#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$ROOT_DIR/../openclawbotonline-02-2"
DELETE_FLAG=""

if [ "${1:-}" = "--delete" ]; then
  DELETE_FLAG="--delete"
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "Target not found: $TARGET_DIR"
  exit 1
fi

rsync -a $DELETE_FLAG \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.wrangler/' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.dev.vars' \
  --exclude='.dev.vars.*' \
  "$ROOT_DIR/" "$TARGET_DIR/"

echo "Synced to: $TARGET_DIR"
