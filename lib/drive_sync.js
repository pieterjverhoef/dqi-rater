/**
 * drive_sync.js — incremental rclone sync from Google Drive at runtime.
 *
 * The container's docker-entrypoint.sh runs `rclone copy` ONCE on start.
 * After that the file system is frozen — new images uploaded to Drive
 * never reach the running server until the next deploy/restart.
 *
 * This module fixes that by:
 *   - exposing a runDriveSync() function that triggers `rclone copy` on
 *     demand (used by POST /api/sync/drive — admin-only),
 *   - and starting a periodic timer (default every 60 min) so even
 *     without a manual trigger, fresh Drive content shows up within
 *     the hour.
 *
 * Both routes use the same `rclone copy` flags as docker-entrypoint.sh:
 *   --exclude '*.json' --exclude '*.txt'
 * so metadata and build logs stay authoritative-from-Git.
 */

import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { registerAllImages } from './registry.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
let UPLOADS_DIR  = path.join(__dirname, '..', 'uploads');
let _db = null;

/**
 * Wire this module to the SQLite DB and (optionally) override the
 * uploads dir. Must be called once at server startup before
 * runDriveSync() is used, otherwise post-copy registration is skipped.
 */
export function initDriveSync(db, uploadsDir) {
  _db = db;
  if (uploadsDir) UPLOADS_DIR = uploadsDir;
}

const RCLONE_CONFIG_PATH = '/root/.config/rclone/rclone.conf';
const SYNC_INTERVAL_MS   = 60 * 60 * 1000;     // 60 min
const SYNC_TIMEOUT_MS    = 10 * 60 * 1000;     // 10 min hard cap per run

// In-memory status, queryable via GET /api/sync/status
const status = {
  last_sync_at:    null,        // ISO timestamp of last completed sync
  last_result:     null,        // { ok, duration_s, error? } of last sync
  last_trigger:    null,        // 'startup' | 'periodic' | 'manual'
  in_progress:     false,
  periodic_enabled: false,
};


// ---------------------------------------------------------------------
// Status query
// ---------------------------------------------------------------------

export function getSyncStatus() {
  return { ...status };
}


// ---------------------------------------------------------------------
// Run a single rclone copy
// ---------------------------------------------------------------------

export function runDriveSync(trigger = 'manual') {
  return new Promise((resolve) => {
    if (status.in_progress) {
      return resolve({ ok: false, skipped: true, reason: 'already in progress' });
    }

    const remote     = process.env.RCLONE_REMOTE || 'gdrive';
    const remotePath = process.env.RCLONE_PATH;
    if (!remotePath) {
      return resolve({ ok: false, skipped: true, reason: 'RCLONE_PATH env var not set' });
    }
    if (!fs.existsSync(RCLONE_CONFIG_PATH)) {
      return resolve({ ok: false, skipped: true, reason: 'rclone.conf not found at ' + RCLONE_CONFIG_PATH });
    }

    status.in_progress = true;
    status.last_trigger = trigger;
    const t0 = Date.now();

    // Same flags as docker-entrypoint.sh
    const rcloneFlags = process.env.RCLONE_FLAGS || '';
    const cmd = (
      `rclone copy "${remote}:${remotePath}" "${UPLOADS_DIR}"` +
      ` --exclude '*.json' --exclude '*.txt' ${rcloneFlags}`
    );
    console.log(`[drive-sync] (${trigger}) starting: ${cmd}`);

    exec(cmd, { timeout: SYNC_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
         async (err, stdout, stderr) => {
      const duration = (Date.now() - t0) / 1000;
      status.in_progress = false;
      status.last_sync_at = new Date().toISOString();

      if (err) {
        console.error(`[drive-sync] (${trigger}) error after ${duration.toFixed(1)}s:`, err.message);
        if (stderr) console.error('[drive-sync] stderr:', stderr.slice(0, 500));
        status.last_result = { ok: false, error: err.message, duration_s: duration };
      } else {
        console.log(`[drive-sync] (${trigger}) done in ${duration.toFixed(1)}s`);

        // Fetch missing metadata.json files from GitHub raw — covers the
        // case where the Docker image doesn't contain them (build cache /
        // .dockerignore weirdness on the host) AND rclone excludes JSON.
        let metaFetched = 0;
        try { metaFetched = await fetchMissingMetadataFromGitHub(UPLOADS_DIR); }
        catch (e) { console.error('[drive-sync] metadata-from-github failed:', e.message); }

        // Re-scan uploads/ and register any folders that newly arrived.
        let newImages = 0;
        if (_db) {
          try {
            const r = registerAllImages(_db, UPLOADS_DIR);
            newImages = r.newImages;
            if (newImages > 0) {
              console.log(`[drive-sync] (${trigger}) registered ${newImages} new images post-copy`);
            }
          } catch (e) {
            console.error('[drive-sync] post-copy registration failed:', e.message);
          }
        }
        status.last_result = {
          ok: true, duration_s: duration,
          new_images: newImages,
          metadata_fetched_from_github: metaFetched,
        };
      }
      resolve(status.last_result);
    });
  });
}


// ---------------------------------------------------------------------
// Pull missing metadata.json files from GitHub raw
//
// Dokploy here doesn't always rebuild the Docker image on push, so the
// image we run with may pre-date the latest metadata commits. rclone
// excludes *.json. To make sure metadata always reaches the running
// server, after every successful rclone we download missing
// metadata.json files directly from the public GitHub repo.
// ---------------------------------------------------------------------

const GITHUB_RAW_BASE =
  process.env.METADATA_GITHUB_RAW ||
  'https://raw.githubusercontent.com/pieterjverhoef/dqi-rater/main';

async function fetchMissingMetadataFromGitHub(uploadsDir) {
  if (!fs.existsSync(uploadsDir)) return 0;
  let fetched = 0;

  const setNames = fs.readdirSync(uploadsDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);

  for (const setName of setNames) {
    const setDir = path.join(uploadsDir, setName);
    const folders = fs.readdirSync(setDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);

    for (const folder of folders) {
      const metaPath = path.join(setDir, folder, 'metadata.json');
      if (fs.existsSync(metaPath)) continue;

      const url = `${GITHUB_RAW_BASE}/uploads/${setName}/${folder}/metadata.json`;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;     // file isn't in repo for this folder
        const text = await res.text();
        fs.writeFileSync(metaPath, text, 'utf8');
        fetched++;
      } catch {
        // network error, skip — periodic timer will retry
      }
    }
  }

  if (fetched > 0) {
    console.log(`[drive-sync] fetched ${fetched} missing metadata.json files from GitHub`);
  }
  return fetched;
}


// ---------------------------------------------------------------------
// Periodic background sync
// ---------------------------------------------------------------------

let _interval = null;

export function startPeriodicSync() {
  if (_interval) return;       // idempotent
  status.periodic_enabled = true;
  console.log(
    `[drive-sync] periodic sync enabled — every ${SYNC_INTERVAL_MS / 60000} min`
  );
  _interval = setInterval(() => {
    runDriveSync('periodic').catch(e =>
      console.error('[drive-sync] periodic exception:', e)
    );
  }, SYNC_INTERVAL_MS);
}

export function stopPeriodicSync() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    status.periodic_enabled = false;
  }
}
