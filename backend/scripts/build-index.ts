#!/usr/bin/env tsx
/**
 * Aozora Bunko indexer
 *
 * Usage:
 *   # Index all public-domain works (takes 20-60 min depending on network)
 *   npx tsx scripts/build-index.ts
 *
 *   # Quick test with first N works
 *   npx tsx scripts/build-index.ts --limit 100
 *
 *   # Resume interrupted run (skips already-indexed works)
 *   npx tsx scripts/build-index.ts --resume
 *
 * Environment variables:
 *   DB_PATH   Path to SQLite database (default: ../data/aozora.db)
 *   DATA_DIR  Path to store downloaded files (default: ../data)
 */

import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import { cleanAozoraText, splitIntoChunks } from './aozora.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, '../../data');
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'aozora.db');
const CATALOG_URL =
  'https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip';
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.zip');

const args = process.argv.slice(2);
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1]) : Infinity;
})();
const RESUME = args.includes('--resume');
const CONCURRENCY = 5;
const RETRY_DELAYS = [1000, 2000, 4000];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (res) => {
      if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

async function downloadWithRetry(url: string, dest: string): Promise<void> {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      await download(url, dest);
      return;
    } catch (err) {
      if (attempt === RETRY_DELAYS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
}

async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

function setupDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -65536');
  db.pragma('temp_store = MEMORY');

  db.exec(`
    CREATE TABLE IF NOT EXISTS works (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id   TEXT UNIQUE NOT NULL,
      title     TEXT NOT NULL,
      author    TEXT NOT NULL,
      card_url  TEXT,
      file_url  TEXT,
      encoding  TEXT
    );

    CREATE TABLE IF NOT EXISTS index_log (
      work_id   TEXT PRIMARY KEY,
      status    TEXT NOT NULL,
      indexed_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
      work_id UNINDEXED,
      text,
      tokenize = 'trigram'
    );
  `);

  return db;
}

// ---------------------------------------------------------------------------
// CSV catalog
// ---------------------------------------------------------------------------

interface CatalogRow {
  work_id: string;
  title: string;
  author: string;
  copyright: string;
  author_copyright: string;
  card_url: string;
  file_url: string;
  encoding: string;
}

async function downloadCatalog(): Promise<Buffer> {
  if (!fs.existsSync(CATALOG_PATH)) {
    console.log('Downloading catalog...');
    await downloadWithRetry(CATALOG_URL, CATALOG_PATH);
  }
  const zip = new AdmZip(CATALOG_PATH);
  const entry = zip.getEntries().find((e) => e.entryName.endsWith('.csv'));
  if (!entry) throw new Error('CSV not found in catalog zip');
  return entry.getData();
}

function parseCatalog(csvBuffer: Buffer): CatalogRow[] {
  const records = parse(csvBuffer.toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as Record<string, string>[];

  return records
    .filter(
      (r) =>
        r['作品著作権フラグ'] === 'なし' &&
        r['人物著作権フラグ'] === 'なし' &&
        r['テキストファイルURL']?.trim()
    )
    .map((r) => ({
      work_id: r['作品ID'],
      title: r['作品名'],
      author: `${r['姓']}　${r['名']}`.trim(),
      copyright: r['作品著作権フラグ'],
      author_copyright: r['人物著作権フラグ'],
      card_url: r['図書カードURL'],
      file_url: r['テキストファイルURL'],
      encoding: r['テキストファイル符号化方式'] ?? 'ShiftJIS',
    }));
}

// ---------------------------------------------------------------------------
// Per-work processing
// ---------------------------------------------------------------------------

function extractText(zipBuffer: Buffer, encoding: string): string | null {
  try {
    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntries().find((e) => e.entryName.endsWith('.txt'));
    if (!entry) return null;
    const raw = entry.getData();
    const enc = encoding.toLowerCase().includes('utf') ? 'utf8' : 'Shift_JIS';
    return iconv.decode(raw, enc);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`DB: ${DB_PATH}`);
  const db = setupDb();

  const csvBuffer = await downloadCatalog();
  let works = parseCatalog(csvBuffer);
  console.log(`Catalog: ${works.length} public-domain works with text files`);

  if (Number.isFinite(LIMIT)) {
    works = works.slice(0, LIMIT);
    console.log(`Limiting to ${LIMIT} works`);
  }

  if (RESUME) {
    const indexed = new Set(
      db
        .prepare<[string], { work_id: string }>('SELECT work_id FROM index_log WHERE status = ?')
        .all('ok')
        .map((r) => r.work_id)
    );
    const before = works.length;
    works = works.filter((w) => !indexed.has(w.work_id));
    console.log(`Resuming: skipping ${before - works.length} already-indexed works`);
  }

  const insertWork = db.prepare(
    `INSERT OR IGNORE INTO works (work_id, title, author, card_url, file_url, encoding)
     VALUES (@work_id, @title, @author, @card_url, @file_url, @encoding)`
  );
  const insertChunk = db.prepare(
    `INSERT INTO chunks (work_id, text) VALUES (?, ?)`
  );
  const logStatus = db.prepare(
    `INSERT OR REPLACE INTO index_log (work_id, status, indexed_at) VALUES (?, ?, ?)`
  );

  let done = 0;
  let errors = 0;
  const total = works.length;
  const startTime = Date.now();

  await pMap(
    works,
    async (work, i) => {
      const tempPath = path.join(DATA_DIR, `_tmp_${process.pid}_${i}.zip`);

      try {
        await downloadWithRetry(work.file_url, tempPath);
        const zipBuf = fs.readFileSync(tempPath);
        const rawText = extractText(zipBuf, work.encoding);

        if (!rawText) {
          logStatus.run(work.work_id, 'no_text', Date.now());
          return;
        }

        const cleaned = cleanAozoraText(rawText);
        const chunks = splitIntoChunks(cleaned);
        if (chunks.length === 0) {
          logStatus.run(work.work_id, 'empty', Date.now());
          return;
        }

        db.transaction(() => {
          insertWork.run(work);
          const row = db
            .prepare<[string], { id: number }>('SELECT id FROM works WHERE work_id = ?')
            .get(work.work_id)!;
          for (const chunk of chunks) {
            insertChunk.run(String(row.id), chunk);
          }
          logStatus.run(work.work_id, 'ok', Date.now());
        })();
      } catch (err) {
        errors++;
        logStatus.run(work.work_id, 'error', Date.now());
        // Don't log every error to avoid noise; summarize at end
      } finally {
        try { fs.unlinkSync(tempPath); } catch {}
        done++;
        if (done % 100 === 0 || done === total) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          const rate = (done / (Date.now() - startTime) * 1000).toFixed(1);
          process.stdout.write(
            `\r[${done}/${total}] ${rate} works/s  elapsed=${elapsed}s  errors=${errors}   `
          );
        }
      }
    },
    CONCURRENCY
  );

  console.log('\nOptimizing FTS index...');
  db.exec("INSERT INTO chunks(chunks) VALUES('optimize')");

  const { works: wCount } = db.prepare<[], { works: number }>('SELECT count(*) AS works FROM works').get()!;
  const { chunks: cCount } = db.prepare<[], { chunks: number }>('SELECT count(*) AS chunks FROM chunks').get()!;
  console.log(`Done! Indexed ${wCount} works, ${cCount} chunks. Errors: ${errors}`);

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
