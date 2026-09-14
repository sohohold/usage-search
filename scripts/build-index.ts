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

import { createClient, type Client } from '@libsql/client';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import { cleanAozoraText, splitIntoChunks } from './aozora.js';
import {
  catalogSourceBlocks,
  decodeText,
  pMap,
  parseCatalog,
  redirectTarget,
  resumeVerdict,
  textUrlFromFileUrl,
  withRetry,
} from './catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, '../data');
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'aozora.db');
// The catalog comes from aozora.gr.jp itself. It used to come from the
// aozorabunko/aozorabunko GitHub mirror, but that repository now 404s on
// master, main and gh-pages alike, card paths included.
// Bodies still come from the aozorahack/aozorabunko_text mirror, which is
// healthy -- see textUrlFromFileUrl in catalog.ts.
const CATALOG_URL =
  process.env.CATALOG_URL ??
  'https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip';
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.zip');
// Records which URL the cached catalog came from. Without it, changing
// CATALOG_URL would keep reading whatever archive a previous run left behind.
const CATALOG_SOURCE_PATH = `${CATALOG_PATH}.source`;

const args = process.argv.slice(2);
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1]) : Infinity;
})();
const RESUME = args.includes('--resume');
const CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONNECT_TIMEOUT_MS = 30_000;

// Node sends no User-Agent at all unless one is set. Requests without it were
// answered with a redirect to mirror.aozora.gr.jp, which then never responded
// from CI runners, while www.aozora.gr.jp serves the catalog fine to ordinary
// clients. Identify ourselves rather than going out anonymously.
const USER_AGENT = 'aozora-usage-search/1.0 (+https://github.com/sohohold/usage-search)';

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    const req = proto.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        let target: string;
        try {
          target = redirectTarget(res.headers.location, url);
        } catch {
          return reject(new Error(`Invalid redirect to ${res.headers.location} from ${url}`));
        }
        return download(target, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.setTimeout(CONNECT_TIMEOUT_MS, () => {
      req.destroy(new Error(`Connection timeout after ${CONNECT_TIMEOUT_MS / 1000}s for ${url}`));
    });
    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function downloadWithRetry(url: string, dest: string): Promise<void> {
  return withRetry(() => download(url, dest));
}

function logStatus(db: Pick<Client, 'execute'>, workId: string, status: string) {
  return db.execute({
    sql: 'INSERT OR REPLACE INTO index_log (work_id, status, indexed_at) VALUES (?, ?, ?)',
    args: [workId, status, Date.now()],
  });
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

async function setupDb(): Promise<Client> {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const client = createClient({ url: `file:${DB_PATH}` });

  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA synchronous = NORMAL');
  await client.execute('PRAGMA cache_size = -65536');
  await client.execute('PRAGMA temp_store = MEMORY');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS works (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id    TEXT UNIQUE NOT NULL,
      title      TEXT NOT NULL,
      author     TEXT NOT NULL,
      author_url TEXT,
      card_url   TEXT,
      file_url   TEXT,
      encoding   TEXT
    )
  `);
  // Databases built before author_url existed keep their schema through CREATE TABLE
  // IF NOT EXISTS, so --resume would fail on the INSERT below without this.
  const columns = await client.execute("SELECT name FROM pragma_table_info('works')");
  if (!columns.rows.some((r) => r.name === 'author_url')) {
    await client.execute('ALTER TABLE works ADD COLUMN author_url TEXT');
  }
  await client.execute(`
    CREATE TABLE IF NOT EXISTS index_log (
      work_id   TEXT PRIMARY KEY,
      status    TEXT NOT NULL,
      indexed_at INTEGER NOT NULL
    )
  `);
  // Holds which catalog the index was built from, so --resume can tell whether
  // the rows already in the database belong to the catalog being indexed now.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
      work_id UNINDEXED,
      text,
      tokenize = 'trigram'
    )
  `);

  return client;
}

// ---------------------------------------------------------------------------
// CSV catalog
// ---------------------------------------------------------------------------

async function downloadCatalog(): Promise<Buffer> {
  const cachedSource = fs.existsSync(CATALOG_SOURCE_PATH)
    ? fs.readFileSync(CATALOG_SOURCE_PATH, 'utf8').trim()
    : null;

  // A catalog left by an earlier run is only reusable when it came from the
  // URL in use now. Otherwise --resume, or any run after CATALOG_URL changes,
  // would index from the previous source without saying so.
  if (!fs.existsSync(CATALOG_PATH) || cachedSource !== CATALOG_URL) {
    console.log('Downloading catalog...');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    await downloadWithRetry(CATALOG_URL, CATALOG_PATH);
    fs.writeFileSync(CATALOG_SOURCE_PATH, CATALOG_URL);
  }
  const zip = new AdmZip(CATALOG_PATH);
  const entry = zip.getEntries().find((e) => e.entryName.endsWith('.csv'));
  if (!entry) throw new Error('CSV not found in catalog zip');
  return entry.getData();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const META_CATALOG_URL = 'catalog_url';

async function readMeta(db: Client, key: string): Promise<string | null> {
  const res = await db.execute({ sql: 'SELECT value FROM meta WHERE key = ?', args: [key] });
  return res.rows.length > 0 ? (res.rows[0].value as string) : null;
}

/**
 * How many works the index actually holds.
 *
 * Counts `works` rather than `index_log`: a work logged as skip, no_text,
 * empty or error never reached `works`, so those entries are not content the
 * catalog label has to account for.
 */
async function countIndexedWorks(db: Client): Promise<number> {
  const res = await db.execute('SELECT count(*) AS n FROM works');
  return Number(res.rows[0].n);
}

/**
 * Refuse to index into an index built from a different catalog, then record the
 * catalog in use. Runs before the download so a rejected run costs nothing.
 */
async function checkCatalogSource(db: Client): Promise<void> {
  const stored = await readMeta(db, META_CATALOG_URL);
  const indexed = await countIndexedWorks(db);

  if (catalogSourceBlocks(stored, CATALOG_URL, { resume: RESUME, indexed })) {
    console.error(
      [
        'This index was built from a different catalog:',
        `  indexed from: ${stored}`,
        `  asked for:    ${CATALOG_URL}`,
        RESUME
          ? '--resume skips every work already marked ok, so those would keep the'
          : 'Works already indexed are kept as they are, so those would keep the',
        'metadata and text produced from the old catalog.',
        `Delete ${DB_PATH} and index again, or point CATALOG_URL back at the`,
        'catalog this index was built from.',
      ].join('\n')
    );
    process.exit(1);
  }

  if (RESUME && resumeVerdict(stored, CATALOG_URL) === 'adopt') {
    console.warn(
      `This index predates catalog tracking, so there is nothing to compare against. Recording ${CATALOG_URL} and continuing.`
    );
  }

  // Safe to claim the catalog now: the check above leaves only an empty index
  // or one already built from this same catalog, so there are no rows from
  // elsewhere for this label to misdescribe.
  await db.execute({
    sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    args: [META_CATALOG_URL, CATALOG_URL],
  });
}

async function main() {
  console.log(`DB: ${DB_PATH}`);
  const client = await setupDb();

  await checkCatalogSource(client);

  const csvBuffer = await downloadCatalog();
  let works = parseCatalog(csvBuffer);
  console.log(`Catalog: ${works.length} public-domain works with text files`);

  if (Number.isFinite(LIMIT)) {
    works = works.slice(0, LIMIT);
    console.log(`Limiting to ${LIMIT} works`);
  }

  if (RESUME) {
    const result = await client.execute({
      sql: 'SELECT work_id FROM index_log WHERE status = ?',
      args: ['ok'],
    });
    const indexed = new Set(result.rows.map((r) => r.work_id as string));
    const before = works.length;
    works = works.filter((w) => !indexed.has(w.work_id));
    console.log(`Resuming: skipping ${before - works.length} already-indexed works`);
  }

  let done = 0;
  let errors = 0;
  const total = works.length;
  const startTime = Date.now();

  await pMap(
    works,
    async (work, i) => {
      const tempPath = path.join(DATA_DIR, `_tmp_${process.pid}_${i}.txt`);

      try {
        const txtUrl = textUrlFromFileUrl(work.file_url);
        if (!txtUrl) {
          console.error(`\nSkipping [${work.work_id}]: unrecognized file_url format: ${work.file_url}`);
          await logStatus(client, work.work_id, 'skip');
          return;
        }
        await downloadWithRetry(txtUrl, tempPath);
        const rawText = decodeText(fs.readFileSync(tempPath), work.encoding);

        if (!rawText) {
          await logStatus(client, work.work_id, 'no_text');
          return;
        }

        const cleaned = cleanAozoraText(rawText);
        const chunks = splitIntoChunks(cleaned);
        if (chunks.length === 0) {
          await logStatus(client, work.work_id, 'empty');
          return;
        }

        // Use a transaction to insert work + chunks atomically
        const tx = await client.transaction('write');
        try {
          await tx.execute({
            sql: `INSERT OR IGNORE INTO works (work_id, title, author, author_url, card_url, file_url, encoding)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [
              work.work_id,
              work.title,
              work.author,
              work.author_url,
              work.card_url,
              work.file_url,
              work.encoding,
            ],
          });
          const row = await tx.execute({
            sql: 'SELECT id FROM works WHERE work_id = ?',
            args: [work.work_id],
          });
          if (row.rows.length === 0) throw new Error(`work not found after insert: ${work.work_id}`);
          const workId = String(row.rows[0].id);
          await tx.batch(
            chunks.map((chunk) => ({
              sql: 'INSERT INTO chunks (work_id, text) VALUES (?, ?)',
              args: [workId, chunk],
            }))
          );
          await logStatus(tx, work.work_id, 'ok');
          await tx.commit();
        } catch (e) {
          await tx.rollback();
          throw e;
        }
      } catch (err) {
        errors++;
        await logStatus(client, work.work_id, 'error').catch(() => {});
        if (errors <= 3) {
          console.error(`\nError [${work.work_id}] file_url=${work.file_url}: ${err instanceof Error ? err.message : err}`);
        }
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
  await client.execute("INSERT INTO chunks(chunks) VALUES('optimize')");

  const wRes = await client.execute('SELECT count(*) AS works FROM works');
  const cRes = await client.execute('SELECT count(*) AS chunks FROM chunks');
  console.log(`Done! Indexed ${wRes.rows[0].works} works, ${cRes.rows[0].chunks} chunks. Errors: ${errors}`);

  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
