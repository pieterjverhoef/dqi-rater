import { Hono } from 'hono';
import crypto from 'crypto';

const router = new Hono();

router.post('/', async (c) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error('GITHUB_WEBHOOK_SECRET is not set');
    return c.json({ error: 'Webhook not configured' }, 500);
  }

  const signature = c.req.header('x-hub-signature-256');
  if (!signature) {
    return c.json({ error: 'Missing signature' }, 401);
  }

  const rawBody = await c.req.text();

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const event = c.req.header('x-github-event');
  if (event !== 'push') {
    return c.json({ message: `Ignored event: ${event}` }, 200);
  }

  const deployUrl = process.env.DOKPLOY_DEPLOY_URL;
  if (!deployUrl) {
    console.error('DOKPLOY_DEPLOY_URL is not set');
    return c.json({ error: 'Deploy URL not configured' }, 500);
  }

  try {
    const res = await fetch(deployUrl, { method: 'POST' });
    console.log(`Dokploy deploy triggered: ${res.status}`);
    return c.json({ message: 'Deploy triggered', status: res.status });
  } catch (err) {
    console.error('Failed to trigger Dokploy deploy:', err.message);
    return c.json({ error: 'Failed to trigger deploy' }, 502);
  }
});

export default router;
