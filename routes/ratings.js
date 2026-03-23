const express = require('express');
const router = express.Router();

// GET /api/ratings/progress/:userId/:setId — all ratings by this user for this set
router.get('/progress/:userId/:setId', (req, res) => {
  const db = req.app.get('db');
  const { userId, setId } = req.params;

  const ratings = db.prepare(`
    SELECT r.image_id, r.score, r.reasoning, r.rated_at
    FROM ratings r
    JOIN images i ON r.image_id = i.id
    WHERE r.user_id = ? AND i.set_id = ?
  `).all(userId, setId);

  // Return as a map: { image_id: { score, reasoning, rated_at } }
  const map = {};
  for (const r of ratings) map[r.image_id] = r;
  res.json(map);
});

// POST /api/ratings — save or update a rating (upsert)
router.post('/', (req, res) => {
  const db = req.app.get('db');
  const { user_id, image_id, score, reasoning } = req.body;

  if (!user_id || !image_id || !score) {
    return res.status(400).json({ error: 'user_id, image_id and score are required' });
  }
  if (score < 1 || score > 4) {
    return res.status(400).json({ error: 'Score must be between 1 and 4' });
  }

  db.prepare(`
    INSERT INTO ratings (user_id, image_id, score, reasoning)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, image_id) DO UPDATE SET
      score = excluded.score,
      reasoning = excluded.reasoning,
      rated_at = datetime('now')
  `).run(user_id, image_id, score, reasoning || null);

  res.json({ success: true });
});

// DELETE /api/ratings/:userId/:setId — remove all ratings by this user for this set
router.delete('/:userId/:setId', (req, res) => {
  const db = req.app.get('db');
  const { userId, setId } = req.params;

  db.prepare(`
    DELETE FROM ratings
    WHERE user_id = ?
      AND image_id IN (SELECT id FROM images WHERE set_id = ?)
  `).run(userId, setId);

  res.json({ success: true });
});

// GET /api/ratings/dashboard/:setId — all ratings for Pieter's dashboard
router.get('/dashboard/:setId', (req, res) => {
  const db = req.app.get('db');
  const data = db.prepare(`
    SELECT
      i.id   AS image_id,
      i.filename,
      i.algorithm_score,
      u.username,
      r.score,
      r.reasoning,
      r.rated_at
    FROM images i
    LEFT JOIN ratings r ON i.id = r.image_id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE i.set_id = ?
    ORDER BY i.filename, u.username
  `).all(req.params.setId);
  res.json(data);
});

module.exports = router;
