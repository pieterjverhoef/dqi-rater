import { Hono } from 'hono';

const router = new Hono();

router.get('/progress/:userId/:setId', (c) => {
  const db = c.get('db');
  const userId = c.req.param('userId');
  const setId = c.req.param('setId');

  const ratings = db.prepare(`
    SELECT r.image_id, r.score, r.reasoning, r.rated_at
    FROM ratings r
    JOIN images i ON r.image_id = i.id
    WHERE r.user_id = ? AND i.set_id = ?
  `).all(userId, setId);

  const map = {};
  for (const r of ratings) map[r.image_id] = r;
  return c.json(map);
});

router.post('/', async (c) => {
  const db = c.get('db');
  const { user_id, image_id, score, reasoning } = await c.req.json();

  if (!user_id || !image_id || !score) {
    return c.json({ error: 'user_id, image_id and score are required' }, 400);
  }
  if (score < 1 || score > 4) {
    return c.json({ error: 'Score must be between 1 and 4' }, 400);
  }

  db.prepare(`
    INSERT INTO ratings (user_id, image_id, score, reasoning)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, image_id) DO UPDATE SET
      score = excluded.score,
      reasoning = excluded.reasoning,
      rated_at = datetime('now')
  `).run(user_id, image_id, score, reasoning || null);

  return c.json({ success: true });
});

router.delete('/:userId/:setId', (c) => {
  const db = c.get('db');
  const userId = c.req.param('userId');
  const setId = c.req.param('setId');

  db.prepare(`
    DELETE FROM ratings
    WHERE user_id = ?
      AND image_id IN (SELECT id FROM images WHERE set_id = ?)
  `).run(userId, setId);

  return c.json({ success: true });
});

router.get('/note/:imageId', (c) => {
  const db = c.get('db');
  const row = db.prepare('SELECT note FROM pieter_notes WHERE image_id = ?')
                .get(c.req.param('imageId'));
  return c.json({ note: row ? row.note : null });
});

router.post('/note', async (c) => {
  const db = c.get('db');
  const { image_id, note } = await c.req.json();
  if (!image_id) return c.json({ error: 'image_id is required' }, 400);

  db.prepare(`
    INSERT INTO pieter_notes (image_id, note, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(image_id) DO UPDATE SET
      note       = excluded.note,
      updated_at = datetime('now')
  `).run(image_id, note || null);

  return c.json({ success: true });
});

router.get('/dashboard/:setId', (c) => {
  const db = c.get('db');
  const data = db.prepare(`
    SELECT
      i.id   AS image_id,
      i.filename,
      i.algorithm_score,
      u.username,
      r.score,
      r.reasoning,
      r.rated_at,
      pn.note AS pieter_note
    FROM images i
    LEFT JOIN ratings r ON i.id = r.image_id
    LEFT JOIN users u ON r.user_id = u.id
    LEFT JOIN pieter_notes pn ON i.id = pn.image_id
    WHERE i.set_id = ?
    ORDER BY i.filename, u.username
  `).all(c.req.param('setId'));
  return c.json(data);
});

export default router;
