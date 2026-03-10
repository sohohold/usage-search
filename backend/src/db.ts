import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/aozora.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH, { readonly: true });

  // Performance tuning for read-heavy workload
  _db.pragma('journal_mode = WAL');
  _db.pragma('cache_size = -65536'); // 64MB page cache
  _db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O
  _db.pragma('temp_store = MEMORY');
  _db.pragma('synchronous = OFF');

  return _db;
}

export interface Work {
  title: string;
  author: string;
  card_url: string;
}

export interface SearchResult {
  title: string;
  author: string;
  card_url: string;
  snippet: string;
}

export interface SearchResponse {
  query: string;
  total: number;
  over_limit: boolean;
  results: SearchResult[];
}

export interface Stats {
  works: number;
  chunks: number;
}

const COUNT_LIMIT = 1000;

export function search(query: string, limit: number, offset: number): SearchResponse {
  const db = getDb();

  // Phrase-quote for exact substring matching with trigram tokenizer
  const ftsQuery = `"${query.replace(/"/g, '""')}"`;

  const results = db
    .prepare<[string, number, number], SearchResult>(
      `SELECT w.title, w.author, w.card_url,
              snippet(chunks, 1, '<mark>', '</mark>', '…', 24) AS snippet
       FROM chunks
       JOIN works w ON chunks.work_id = CAST(w.id AS TEXT)
       WHERE chunks MATCH ?
       ORDER BY bm25(chunks)
       LIMIT ? OFFSET ?`
    )
    .all(ftsQuery, limit, offset);

  const { count } = db
    .prepare<[string, number], { count: number }>(
      `SELECT count(*) AS count FROM (
         SELECT 1 FROM chunks WHERE chunks MATCH ? LIMIT ?
       )`
    )
    .get(ftsQuery, COUNT_LIMIT + 1)!;

  return {
    query,
    total: Math.min(count, COUNT_LIMIT),
    over_limit: count > COUNT_LIMIT,
    results,
  };
}

export function getStats(): Stats {
  const db = getDb();
  const { works } = db
    .prepare<[], { works: number }>('SELECT count(*) AS works FROM works')
    .get()!;
  const { chunks } = db
    .prepare<[], { chunks: number }>('SELECT count(*) AS chunks FROM chunks')
    .get()!;
  return { works, chunks };
}
