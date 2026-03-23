const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// GET /api/images/sets — list all registered sets
router.get('/sets', (req, res) => {
  const db = req.app.get('db');
  const sets = db.prepare('SELECT * FROM image_sets ORDER BY created_at DESC').all();
  res.json(sets);
});

// GET /api/images/set/:setId — get all images in a set
router.get('/set/:setId', (req, res) => {
  const db = req.app.get('db');
  const images = db.prepare(
    'SELECT * FROM images WHERE set_id = ? ORDER BY filename'
  ).all(req.params.setId);
  res.json(images);
});

// GET /api/images/metadata/:setId/:folder — load metadata.json for one image
router.get('/metadata/:setId/:folder', (req, res) => {
  const db = req.app.get('db');
  const set = db.prepare('SELECT * FROM image_sets WHERE id = ?').get(req.params.setId);
  if (!set) return res.status(404).json({ error: 'Set not found' });

  const metaPath = path.join(UPLOADS_DIR, set.name, req.params.folder, 'metadata.json');
  if (!fs.existsSync(metaPath)) return res.json(null);

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    res.json(meta);
  } catch {
    res.status(500).json({ error: 'Failed to read metadata.json' });
  }
});

// POST /api/images/register — scan an uploads subfolder and register it as a set
router.post('/register', (req, res) => {
  const db = req.app.get('db');
  const { setName } = req.body;
  if (!setName) return res.status(400).json({ error: 'setName is required' });

  const setDir = path.join(UPLOADS_DIR, setName);
  if (!fs.existsSync(setDir)) {
    return res.status(404).json({ error: `Folder "${setName}" not found in uploads/` });
  }

  // Find all subfolders (each is one image)
  const entries = fs.readdirSync(setDir, { withFileTypes: true });
  const imageFolders = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

  if (imageFolders.length === 0) {
    return res.status(400).json({ error: 'No image folders found in this set' });
  }

  // Insert set
  db.prepare('INSERT OR IGNORE INTO image_sets (name) VALUES (?)').run(setName);
  const set = db.prepare('SELECT * FROM image_sets WHERE name = ?').get(setName);

  // Insert images, reading algorithm_score from metadata.json if present
  const insertImage = db.prepare(
    'INSERT OR IGNORE INTO images (set_id, filename, algorithm_score) VALUES (?, ?, ?)'
  );

  let registered = 0;
  let incomplete = 0;
  for (const folder of imageFolders) {
    const folderPath = path.join(setDir, folder);

    // Only register if all three visuals exist
    const hasOriginal = fs.existsSync(path.join(folderPath, 'original.jpg'));
    const hasFpc      = fs.existsSync(path.join(folderPath, 'fpc_result.jpg'));
    const hasGrid     = fs.existsSync(path.join(folderPath, 'grid_overlay.jpg'));
    if (!hasOriginal || !hasFpc || !hasGrid) { incomplete++; continue; }

    // Only register if metadata.json has a cv_rating
    const metaPath = path.join(folderPath, 'metadata.json');
    let algorithmScore = null;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (!meta.cv_rating) { incomplete++; continue; }
        algorithmScore = meta.algorithm_score ?? null;
      } catch { incomplete++; continue; }
    } else { incomplete++; continue; }

    insertImage.run(set.id, folder, algorithmScore);
    registered++;
  }
  console.log(`Registered ${registered} images, skipped ${incomplete} incomplete.`);

  const images = db.prepare('SELECT * FROM images WHERE set_id = ?').all(set.id);
  res.json({ set, images });
});

module.exports = router;
