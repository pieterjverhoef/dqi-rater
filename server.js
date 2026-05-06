import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import authRoutes from './routes/auth.js';
import imageRoutes from './routes/images.js';
import ratingRoutes from './routes/ratings.js';
import deployRoutes from './routes/deploy.js';
import syncRoutes from './routes/sync.js';
import { initDriveSync, startPeriodicSync } from './lib/drive_sync.js';
import { registerAllImages } from './lib/registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = new Hono();
const PORT = 3000;

const db = new Database(path.join(__dirname, 'database', 'dqi-rater.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'rater'
  );

  CREATE TABLE IF NOT EXISTS image_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    algorithm_score INTEGER,
    UNIQUE(set_id, filename),
    FOREIGN KEY (set_id) REFERENCES image_sets(id)
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    image_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    reasoning TEXT,
    rated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, image_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (image_id) REFERENCES images(id)
  );

  CREATE TABLE IF NOT EXISTS pieter_notes (
    image_id INTEGER PRIMARY KEY,
    note TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (image_id) REFERENCES images(id)
  );
`);

const insertUser = db.prepare(
  `INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`
);
insertUser.run('pieter',  'pieter123',  'admin');
insertUser.run('cobus',   'cobus123',   'rater');
insertUser.run('marius',  'marius123',  'rater');

app.use('*', async (c, next) => {
  c.set('db', db);
  await next();
});

app.route('/api/auth',    authRoutes);
app.route('/api/images',  imageRoutes);
app.route('/api/ratings', ratingRoutes);
app.route('/api/deploy',  deployRoutes);
app.route('/api/sync',    syncRoutes);

app.use('/uploads/*', serveStatic({ root: './' }));
app.use('/*', serveStatic({ root: './public' }));

const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Auto-register all complete image folders into the DB. The same logic is
// reused after every drive sync so newly arrived folders get picked up
// without needing a server restart.
registerAllImages(db, UPLOADS_DIR);

// Wire the drive-sync to this DB so it can re-register images after
// a successful copy (without this, newly synced folders would sit on
// disk but never appear in the rater until the next server restart).
initDriveSync(db, UPLOADS_DIR);

// Start the periodic Drive sync. Runs `rclone copy` once an hour so
// new images uploaded to Drive show up without needing a redeploy.
// Skips silently if rclone.conf or RCLONE_PATH aren't configured
// (i.e. in local dev without Drive credentials).
startPeriodicSync();

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`DQI Rater running at http://localhost:${PORT}`);
});
