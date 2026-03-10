import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { search, getStats } from './db.js';

const app = new Hono();

app.use('*', cors());

app.get('/api/search', (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '20'), 1), 50);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0'), 0);

  if (q.length < 2) {
    return c.json({ error: '2文字以上入力してください' }, 400);
  }

  try {
    const result = search(q, limit, offset);
    return c.json(result);
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: '検索中にエラーが発生しました' }, 500);
  }
});

app.get('/api/stats', (c) => {
  try {
    return c.json(getStats());
  } catch {
    return c.json({ works: 0, chunks: 0 });
  }
});

app.get('/health', (c) => c.json({ ok: true }));

const port = parseInt(process.env.PORT ?? '3001');
serve({ fetch: app.fetch, port }, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
