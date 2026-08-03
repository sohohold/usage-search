import { createClient } from '@libsql/client';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const WORKS = [
  {
    work_id: '773',
    title: 'こころ',
    author: '夏目　漱石',
    card_url: 'https://example.com/cards/card773.html',
  },
  {
    work_id: '900',
    title: '月と六ペンス',
    author: 'モーム　サマセット',
    card_url: 'https://example.com/cards/card900.html',
  },
] as const;

/** A chunk long enough that a 64-token excerpt is visibly wider than a 24-token one. */
export const LONG_CHUNK =
  'あ'.repeat(120) + 'ここに目印となる語がある。' + 'い'.repeat(120);

export const CHUNKS: { work: 0 | 1; text: string }[] = [
  { work: 0, text: 'その夜は月が綺麗で、私は縁側に腰を下ろしていた。' },
  { work: 1, text: '空を見上げると月が綺麗だと素直に思えた。' },
  { work: 0, text: LONG_CHUNK },
  { work: 0, text: '引用符"を含む一節がここにある。' },
  { work: 1, text: '星がまたたく夜だったと記憶している。' },
  // 12 rows for the paging cases; each is numbered so ordering is observable.
  ...Array.from({ length: 12 }, (_, i) => ({
    work: (i % 2) as 0 | 1,
    text: `ページング検証用の第${String(i).padStart(2, '0')}番目の段落である。`,
  })),
];

export const TOTAL_WORKS = WORKS.length;
export const TOTAL_CHUNKS = CHUNKS.length;

/**
 * Build a throwaway SQLite database with the indexer's schema and a known corpus.
 * Returns the `file:` URL to point TURSO_DATABASE_URL at, plus a cleanup function.
 */
export async function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-search-test-'));
  const dbPath = path.join(dir, 'test.db');
  const client = createClient({ url: `file:${dbPath}` });

  await client.execute(`
    CREATE TABLE works (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id   TEXT UNIQUE NOT NULL,
      title     TEXT NOT NULL,
      author    TEXT NOT NULL,
      card_url  TEXT,
      file_url  TEXT,
      encoding  TEXT
    )
  `);
  await client.execute(`
    CREATE VIRTUAL TABLE chunks USING fts5(
      work_id UNINDEXED,
      text,
      tokenize = 'trigram'
    )
  `);

  const ids: string[] = [];
  for (const w of WORKS) {
    await client.execute({
      sql: 'INSERT INTO works (work_id, title, author, card_url) VALUES (?, ?, ?, ?)',
      args: [w.work_id, w.title, w.author, w.card_url],
    });
    const row = await client.execute({
      sql: 'SELECT id FROM works WHERE work_id = ?',
      args: [w.work_id],
    });
    ids.push(String(row.rows[0].id));
  }

  for (const c of CHUNKS) {
    await client.execute({
      sql: 'INSERT INTO chunks (work_id, text) VALUES (?, ?)',
      args: [ids[c.work], c.text],
    });
  }

  client.close();

  return {
    url: `file:${dbPath}`,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
