import { Hono } from 'hono';

const router = new Hono();

router.post('/login', async (c) => {
  const db = c.get('db');
  const { username, password } = await c.req.json();

  if (!username || !password) {
    return c.json({ error: 'Username and password are required.' }, 400);
  }

  const user = db.prepare(
    `SELECT id, username, role FROM users WHERE username = ? AND password = ?`
  ).get(username.toLowerCase(), password);

  if (!user) {
    return c.json({ error: 'Invalid username or password.' }, 401);
  }

  return c.json({ id: user.id, username: user.username, role: user.role });
});

export default router;
