#!/bin/bash
set -e

# Sync from Google Drive if rclone is configured
if [ -f /root/.config/rclone/rclone.conf ]; then
  REMOTE="${RCLONE_REMOTE:-gdrive}"
  REMOTE_PATH="${RCLONE_PATH:-}"
  if [ -n "$REMOTE_PATH" ]; then
    echo "Copying images from ${REMOTE}:${REMOTE_PATH} ..."
    RCLONE_FLAGS="${RCLONE_FLAGS:-}"
    mkdir -p "/app/uploads"
    # Use `rclone copy` (non-destructive) instead of `rclone sync`. Sync would
    # delete files in /app/uploads that are not in Drive — including the
    # metadata.json files that ship in the Git repo (the .gitignore allows
    # JSON, only binary images are excluded). Without metadata.json the rater
    # cannot detect set_type and falls back to the legacy 1..4 UI.
    #
    # Also exclude *.json from copy: even if a stale metadata.json sits in
    # Drive (e.g. from a previous upload), the Git-shipped version wins.
    # Metadata is always considered authoritative from the repo.
    rclone copy "${REMOTE}:${REMOTE_PATH}" "/app/uploads" --progress \
        --exclude '*.json' --exclude '*.txt' $RCLONE_FLAGS
    echo "Copy complete."
  else
    echo "RCLONE_PATH not set, skipping image sync."
  fi
else
  echo "No rclone.conf found, skipping image sync."
fi

exec node server.js
