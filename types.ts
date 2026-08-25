/**
 * クライアントが自動検索を始める最短クエリ長。サーバ側の下限は
 * `lib/search.ts` の `minQueryLength()`（バックエンドが決める）で、こちらは
 * クライアントに埋め込むための値。Elasticsearch に切り替えるときは
 * `NEXT_PUBLIC_MIN_QUERY_LENGTH=1` を一緒に設定する。
 * 既定の 3 は SQLite(trigram) の制約に由来する。
 */
export const MIN_QUERY_LENGTH = Number(process.env.NEXT_PUBLIC_MIN_QUERY_LENGTH ?? 3);
export const PAGE_SIZE = 20;
// Ceiling on the client-supplied `limit`, so one request can't scan the whole index.
export const MAX_PAGE_SIZE = 50;
/** Elasticsearch の `index.max_result_window` と揃える。これ以上深くはページングできない。 */
export const MAX_RESULT_WINDOW = 20_000;

export interface SearchResult {
  title: string;
  author: string;
  // The author's "作家別作品リスト" page. Null when the catalog row had no person ID,
  // and absent from responses cached before this field existed.
  author_url?: string | null;
  card_url: string;
  snippet: string;
  // Wider excerpt around the same match (~2.7x the snippet), shown when a card is expanded.
  context: string;
}

export interface SearchResponse {
  query: string;
  over_limit: boolean;
  results: SearchResult[];
}

export interface Stats {
  works: number;
  chunks: number;
}
