import { Client } from '@elastic/elasticsearch';
import { createIndex } from '@/lib/es/index-settings';
import { CHUNKS, WORKS } from './db';

/** 未設定なら Elasticsearch を要するテストは丸ごとスキップする（CI では service で起動する）。 */
export const ES_URL = process.env.ELASTICSEARCH_URL;

/** テスト用のクライアント。lib/es/client.ts のキャッシュとは独立に使う。 */
export function newClient(): Client {
  return new Client({
    node: ES_URL!,
    ...(process.env.ELASTICSEARCH_API_KEY ? { auth: { apiKey: process.env.ELASTICSEARCH_API_KEY } } : {}),
  });
}

/**
 * 使い捨ての索引に、SQLite 版と同じコーパスを投入する。
 * 索引名を毎回変えるので、並行実行しても混ざらない。
 */
export async function createTestIndex() {
  const client = newClient();
  const index = `test-aozora-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await createIndex(client, index);

  const operations = CHUNKS.flatMap((chunk, i) => {
    const work = WORKS[chunk.work];
    return [
      { index: { _index: index } },
      {
        work_id: work.work_id,
        title: work.title,
        author: work.author,
        author_url: work.author_url,
        card_url: work.card_url,
        // 投入順 = SQLite 版の rowid 順。並び順の比較を同じ土俵に乗せる。
        seq: i,
        text: chunk.text,
      },
    ];
  });
  const res = await client.bulk({ operations, refresh: true });
  if (res.errors) {
    const first = res.items.find((it) => it.index?.error)?.index?.error;
    throw new Error(`テスト用索引の投入に失敗: ${JSON.stringify(first)}`);
  }

  return {
    index,
    client,
    cleanup: async () => {
      await client.indices.delete({ index }, { ignore: [404] });
      await client.close();
    },
  };
}
