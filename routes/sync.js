/**
 * sync.js — admin endpoints to control the runtime drive sync.
 *
 *   GET  /api/sync/status            — current sync status (anyone logged in)
 *   GET  /api/sync/diagnostics       — per-set folder counts + reasons for unregistered folders
 *   POST /api/sync/drive             — trigger an immediate rclone copy (admin only)
 *
 * The POST body should contain { user_id }. We verify the user has
 * role='admin' before running the sync. (The session model in this app
 * is loose — sessionStorage on the frontend — so server-side we accept
 * the user_id and look up the role.)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Hono } from 'hono';
import { runDriveSync, getSyncStatus } from '../lib/drive_sync.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const router = new Hono();


// --- Public: status ----------------------------------------------------

router.get('/status', (c) => {
  return c.json(getSyncStatus());
});


// --- Diagnostics: tells you EXACTLY what's on the disk vs in the DB ----
// For each set, returns folder counts and lists folders that are present
// on disk but failed to register, with the reason. Used by Pieter to
// debug "I uploaded N folders to Drive, why don't they show up?".

router.get('/diagnostics', (c) => {
  const db = c.get('db');
  const report = { uploads_dir_exists: fs.existsSync(UPLOADS_DIR), sets: [] };
  if (!report.uploads_dir_exists) return c.json(report);

  const setDirs = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  for (const setName of setDirs) {
    const setRow = db.prepare('SELECT id FROM image_sets WHERE name = ?').get(setName);
    const setDir = path.join(UPLOADS_DIR, setName);
    const folders = fs.readdirSync(setDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    let inDbCount = 0;
    if (setRow) {
      inDbCount = db.prepare('SELECT COUNT(*) AS n FROM images WHERE set_id = ?').get(setRow.id).n;
    }

    // Look for folders on disk that are NOT in the DB and find out why
    const dbFilenames = setRow
      ? new Set(db.prepare('SELECT filename FROM images WHERE set_id = ?').all(setRow.id).map(r => r.filename))
      : new Set();

    const unregistered = [];
    for (const folder of folders) {
      if (dbFilenames.has(folder)) continue;
      const folderPath = path.join(setDir, folder);
      const reasons = [];
      if (!fs.existsSync(path.join(folderPath, 'original.jpg')))    reasons.push('no original.jpg');
      if (!fs.existsSync(path.join(folderPath, 'fpc_result.jpg')))  reasons.push('no fpc_result.jpg');
      if (!fs.existsSync(path.join(folderPath, 'grid_overlay.jpg'))) reasons.push('no grid_overlay.jpg');
      const metaPath = path.join(folderPath, 'metadata.json');
      if (!fs.existsSync(metaPath)) {
        reasons.push('no metadata.json');
      } else {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          if (!meta.cv_rating && !meta.moran_rating_v2) reasons.push('metadata missing cv_rating/moran_rating_v2');
        } catch (e) {
          reasons.push('metadata.json parse error: ' + e.message);
        }
      }
      unregistered.push({ folder, reasons });
    }

    report.sets.push({
      set:                setName,
      folders_on_disk:    folders.length,
      images_in_db:       inDbCount,
      unregistered_count: unregistered.length,
      unregistered:       unregistered.slice(0, 30),  // cap output
    });
  }
  return c.json(report);
});


// --- Admin: trigger immediate sync ------------------------------------

router.post('/drive', async (c) => {
  let body = {};
  try { body = await c.req.json(); } catch { /* empty body is fine */ }
  const userId = body.user_id;
  if (!userId) return c.json({ error: 'user_id required' }, 400);

  const db = c.get('db');
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (!user)             return c.json({ error: 'user not found' }, 404);
  if (user.role !== 'admin') return c.json({ error: 'admin only' }, 403);

  const result = await runDriveSync('manual');
  return c.json(result);
});


export default router;
