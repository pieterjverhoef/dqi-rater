import { Hono } from 'hono';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = new Hono();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

router.get('/sets', (c) => {
  const db = c.get('db');
  const sets = db.prepare('SELECT * FROM image_sets ORDER BY created_at DESC').all();
  return c.json(sets);
});

router.get('/set/:setId', (c) => {
  const db = c.get('db');
  const images = db.prepare(
    'SELECT * FROM images WHERE set_id = ? ORDER BY filename'
  ).all(c.req.param('setId'));
  return c.json(images);
});

router.get('/metadata/:setId/:folder', (c) => {
  const db = c.get('db');
  const set = db.prepare('SELECT * FROM image_sets WHERE id = ?').get(c.req.param('setId'));
  if (!set) return c.json({ error: 'Set not found' }, 404);

  const metaPath = path.join(UPLOADS_DIR, set.name, c.req.param('folder'), 'metadata.json');
  if (!fs.existsSync(metaPath)) return c.json(null);

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return c.json(meta);
  } catch {
    return c.json({ error: 'Failed to read metadata.json' }, 500);
  }
});

router.post('/register', async (c) => {
  const db = c.get('db');
  const { setName } = await c.req.json();
  if (!setName) return c.json({ error: 'setName is required' }, 400);

  const setDir = path.join(UPLOADS_DIR, setName);
  if (!fs.existsSync(setDir)) {
    return c.json({ error: `Folder "${setName}" not found in uploads/` }, 404);
  }

  const entries = fs.readdirSync(setDir, { withFileTypes: true });
  const imageFolders = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

  if (imageFolders.length === 0) {
    return c.json({ error: 'No image folders found in this set' }, 400);
  }

  db.prepare('INSERT OR IGNORE INTO image_sets (name) VALUES (?)').run(setName);
  const set = db.prepare('SELECT * FROM image_sets WHERE name = ?').get(setName);

  const insertImage = db.prepare(
    'INSERT OR IGNORE INTO images (set_id, filename, algorithm_score) VALUES (?, ?, ?)'
  );

  let registered = 0;
  let incomplete = 0;
  for (const folder of imageFolders) {
    const folderPath = path.join(setDir, folder);

    const hasOriginal = fs.existsSync(path.join(folderPath, 'original.jpg'));
    const hasFpc      = fs.existsSync(path.join(folderPath, 'fpc_result.jpg'));
    const hasGrid     = fs.existsSync(path.join(folderPath, 'grid_overlay.jpg'));
    if (!hasOriginal || !hasFpc || !hasGrid) { incomplete++; continue; }

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
  return c.json({ set, images });
});

export default router;
