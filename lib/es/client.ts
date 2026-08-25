import { Client } from '@elastic/elasticsearch';

/**
 * 検索が読むエイリアス。再インデックスは新しい索引を作ってここを張り替える。
 * モジュール定数ではなく関数なのは、テストが索引名を差し替えられるようにするため。
 */
export function searchIndex(): string {
  return process.env.ELASTICSEARCH_INDEX ?? 'aozora-chunks';
}

let _client: Client | null = null;

/**
 * Elasticsearch クライアント。API キー方式は Elastic Cloud でも自前ホストでも同じなので、
 * 接続先の選択（マネージド / 自前）はコードに現れない。
 */
export function getEsClient(): Client {
  if (_client) return _client;

  const node = process.env.ELASTICSEARCH_URL;
  if (!node) throw new Error('ELASTICSEARCH_URL が設定されていません');

  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  _client = new Client({
    node,
    ...(apiKey ? { auth: { apiKey } } : {}),
    // Vercel の関数は短命なので、リトライで握りつぶすより早く失敗させる。
    requestTimeout: 5_000,
    maxRetries: 2,
  });
  return _client;
}

/** テスト用。プロセス内のキャッシュを捨てる。 */
export function resetEsClient(): void {
  _client = null;
}
