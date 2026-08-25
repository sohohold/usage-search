#!/usr/bin/env tsx
/**
 * SQLite の索引（`scripts/build-index.ts` が作るもの）を Elasticsearch に流し込む。
 *
 * 本文のダウンロードと整形は既存のインデクサのままで、ここは載せ替えだけを行う。
 * 青空文庫の取得と整形を作り直さずに済み、SQLite ファイルが中間成果物として残るため、
 * ES を作り直したくなったときにネットワークからやり直さなくてよい。
 *
 * Usage:
 *   ELASTICSEARCH_URL=http://localhost:9200 npx tsx scripts/es-load.ts
 *   npx tsx scripts/es-load.ts --index aozora-chunks-20260825   # 索引名を指定
 *   npx tsx scripts/es-load.ts --no-alias                       # エイリアスは張り替えない
 *
 * 環境変数:
 *   DB_PATH               読み込む SQLite（既定 ./data/aozora.db）
 *   ELASTICSEARCH_URL     接続先（必須）
 *   ELASTICSEARCH_API_KEY API キー（自前ホストで認証なしなら不要）
 *   ELASTICSEARCH_INDEX   検索が読むエイリアス名（既定 aozora-chunks）
 */

import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEsClient, searchIndex } from '../lib/es/client.js';
import { createIndex } from '../lib/es/index-settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../data/aozora.db');

const args = process.argv.slice(2);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const ALIAS = searchIndex();
const INDEX = argValue('--index') ?? `${ALIAS}-${stamp}`;
const SWITCH_ALIAS = !args.includes('--no-alias');
const BATCH = 2_000;

/** 索引に入れるドキュメント。マッピングは dynamic: strict なので、余計な項目を入れない。 */
interface ChunkDoc {
  work_id: string;
  title: string;
  author: string;
  author_url: string | null;
  card_url: string;
  /** SQLite の rowid。作品順・段落順に並ぶ通し番号で、同点時の並び順を決めるために使う。 */
  seq: number;
  text: string;
}

/** rowid で区切って読む。全件を一度にメモリへ載せないため。 */
async function* readChunks(dbUrl: string): AsyncGenerator<ChunkDoc> {
  const db = createClient({ url: dbUrl });
  const hasAuthorUrl = (
    await db.execute("SELECT 1 FROM pragma_table_info('works') WHERE name = 'author_url'")
  ).rows.length > 0;

  let after = 0;
  for (;;) {
    const res = await db.execute({
      sql: `SELECT c.rowid AS id, w.work_id, w.title, w.author,
                   ${hasAuthorUrl ? 'w.author_url' : 'NULL'} AS author_url,
                   w.card_url, c.text
              FROM chunks c
              JOIN works w ON w.id = CAST(c.work_id AS INTEGER)
             WHERE c.rowid > ?
             ORDER BY c.rowid
             LIMIT ?`,
      args: [after, BATCH],
    });
    if (res.rows.length === 0) break;
    for (const row of res.rows) {
      after = Number(row.id);
      yield {
        seq: after,
        work_id: String(row.work_id),
        title: String(row.title),
        author: String(row.author),
        author_url: (row.author_url as string | null) ?? null,
        card_url: String(row.card_url ?? ''),
        text: String(row.text),
      };
    }
  }
  db.close();
}

async function main() {
  const es = getEsClient();
  console.log(`SQLite: ${DB_PATH}`);
  console.log(`索引を作成: ${INDEX}`);
  await createIndex(es, INDEX);

  let count = 0;
  const start = Date.now();
  const result = await es.helpers.bulk({
    datasource: readChunks(`file:${DB_PATH}`),
    onDocument() {
      count++;
      if (count % 50_000 === 0) {
        const rate = (count / ((Date.now() - start) / 1000)).toFixed(0);
        process.stdout.write(`\r  ${count} 件 (${rate} docs/s)   `);
      }
      return { index: { _index: INDEX } };
    },
    onDrop(doc) {
      console.error('\n投入に失敗:', doc.error?.reason ?? doc.error);
    },
    flushBytes: 5_000_000,
    concurrency: 2,
  });
  console.log(`\n投入完了: ${result.successful} 件成功 / ${result.failed} 件失敗 / ${(result.time / 1000).toFixed(0)}s`);

  if (result.failed > 0) {
    // 一部でも落ちた索引をエイリアスに繋ぐと、検索結果に穴が空いたまま公開されてしまう。
    throw new Error(`${result.failed} 件が投入できなかったため、エイリアスは張り替えません`);
  }

  await es.indices.refresh({ index: INDEX });
  // 検索専用なので1セグメントに寄せる。索引サイズが縮み、フレーズ検索も速くなる。
  await es.indices.forcemerge({ index: INDEX, max_num_segments: 1 });

  const stats = await es.count({ index: INDEX });
  console.log(`索引 ${INDEX}: ${stats.count} ドキュメント`);

  if (SWITCH_ALIAS) {
    const exists = await es.indices.existsAlias({ name: ALIAS });
    await es.indices.updateAliases({
      actions: [
        // 旧索引からの切り離しと新索引への付け替えを1回のリクエストで行う（切り替えは瞬時）。
        ...(exists ? [{ remove: { index: '*', alias: ALIAS } }] : []),
        { add: { index: INDEX, alias: ALIAS } },
      ],
    });
    console.log(`エイリアス ${ALIAS} → ${INDEX} に張り替えました`);
    console.log('旧索引は残っています。確認後に DELETE /<旧索引名> で削除してください。');
  } else {
    console.log(`エイリアスは変更していません。切り替えるには:\n  POST /_aliases {"actions":[{"remove":{"index":"*","alias":"${ALIAS}"}},{"add":{"index":"${INDEX}","alias":"${ALIAS}"}}]}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
