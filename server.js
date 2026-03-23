const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

// --- Database setup ---
const db = new Database(path.join(__dirname, 'database', 'dqi-rater.sqlite'));

// Create tables if they don't exist yet
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
`);

// Seed the 3 fixed user accounts if they don't exist yet
const insertUser = db.prepare(
  `INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)`
);
insertUser.run('pieter',  'pieter123',  'admin');
insertUser.run('cobus',   'cobus123',   'rater');
insertUser.run('marius',  'marius123',  'rater');

// --- Middleware ---
app.use(express.json());

// Make db available to route files
app.set('db', db);

// --- API Routes (registered before static so they are never intercepted) ---
const authRoutes    = require('./routes/auth');
const imageRoutes   = require('./routes/images');
const ratingRoutes  = require('./routes/ratings');

app.use('/api/auth',    authRoutes);
app.use('/api/images',  imageRoutes);
app.use('/api/ratings', ratingRoutes);

// --- Static files (after API routes) ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Auto-register any upload folders not yet in the database ---
const fs = require('fs');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (fs.existsSync(UPLOADS_DIR)) {
  const setDirs = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  const insertSet = db.prepare('INSERT OR IGNORE INTO image_sets (name) VALUES (?)');
  const getSet = db.prepare('SELECT * FROM image_sets WHERE name = ?');
  const insertImage = db.prepare(
    'INSERT OR IGNORE INTO images (set_id, filename, algorithm_score) VALUES (?, ?, ?)'
  );

  for (const setName of setDirs) {
    insertSet.run(setName);
    const set = getSet.get(setName);
    const setDir = path.join(UPLOADS_DIR, setName);

    const folders = fs.readdirSync(setDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    let registered = 0;
    for (const folder of folders) {
      const folderPath = path.join(setDir, folder);
      const hasOriginal = fs.existsSync(path.join(folderPath, 'original.jpg'));
      const hasFpc = fs.existsSync(path.join(folderPath, 'fpc_result.jpg'));
      const hasGrid = fs.existsSync(path.join(folderPath, 'grid_overlay.jpg'));
      if (!hasOriginal || !hasFpc || !hasGrid) continue;

      const metaPath = path.join(folderPath, 'metadata.json');
      let algorithmScore = null;
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          if (!meta.cv_rating) continue;
          algorithmScore = meta.algorithm_score ?? null;
        } catch { continue; }
      } else { continue; }

      insertImage.run(set.id, folder, algorithmScore);
      registered++;
    }
    if (registered > 0) console.log(`Auto-registered ${registered} images in set "${setName}"`);
  }
}

// --- Start server ---
app.listen(PORT, () => {
  console.log(`DQI Rater running at http://localhost:${PORT}`);
});
