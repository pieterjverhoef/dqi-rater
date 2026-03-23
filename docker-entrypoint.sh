#!/bin/bash
set -e

# Sync from Google Drive if rclone is configured
if [ -f /root/.config/rclone/rclone.conf ]; then
  REMOTE="${RCLONE_REMOTE:-gdrive}"
  REMOTE_PATH="${RCLONE_PATH:-}"
  if [ -n "$REMOTE_PATH" ]; then
    echo "Syncing images from ${REMOTE}:${REMOTE_PATH} ..."
    RCLONE_FLAGS="${RCLONE_FLAGS:-}"
    SET_NAME=$(basename "${REMOTE_PATH}")
    mkdir -p "/app/uploads/${SET_NAME}"
    rclone sync "${REMOTE}:${REMOTE_PATH}" "/app/uploads/${SET_NAME}" --progress $RCLONE_FLAGS
    echo "Sync complete."
  else
    echo "RCLONE_PATH not set, skipping image sync."
  fi
else
  echo "No rclone.conf found, skipping image sync."
fi

exec node server.js
