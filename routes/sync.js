/**
 * sync.js — admin endpoints to control the runtime drive sync.
 *
 *   GET  /api/sync/status            — current sync status (anyone logged in)
 *   POST /api/sync/drive             — trigger an immediate rclone copy (admin only)
 *
 * The POST body should contain { user_id }. We verify the user has
 * role='admin' before running the sync. (The session model in this app
 * is loose — sessionStorage on the frontend — so server-side we accept
 * the user_id and look up the role.)
 */

import { Hono } from 'hono';
import { runDriveSync, getSyncStatus } from '../lib/drive_sync.js';

const router = new Hono();


// --- Public: status ----------------------------------------------------

router.get('/status', (c) => {
  return c.json(getSyncStatus());
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
