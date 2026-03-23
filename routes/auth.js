const express = require('express');
const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const db = req.app.get('db');
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = db.prepare(
    `SELECT id, username, role FROM users WHERE username = ? AND password = ?`
  ).get(username.toLowerCase(), password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  res.json({ id: user.id, username: user.username, role: user.role });
});

module.exports = router;
