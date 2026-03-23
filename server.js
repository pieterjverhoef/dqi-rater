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

// --- Start server ---
app.listen(PORT, () => {
  console.log(`DQI Rater running at http://localhost:${PORT}`);
});
