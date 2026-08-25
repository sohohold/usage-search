import type { SearchResponse, Stats } from '@/types';
import * as sqlite from './db';
import * as elasticsearch from './es/search';

export type Backend = 'elasticsearch' | 'sqlite';

/**
 * 検索バックエンドの選択。既定は SQLite（Turso）で、`SEARCH_BACKEND=elasticsearch` を
 * 立てると Elasticsearch を見る。移行中は両方を残し、索引を作り終えた環境から切り替える。
 * 移行が終わったら SQLite 側と、このディスパッチごと消す（docs/elasticsearch.md §移行）。
 */
export function backend(): Backend {
  return process.env.SEARCH_BACKEND === 'elasticsearch' ? 'elasticsearch' : 'sqlite';
}

/** そのバックエンドで意味のある最短クエリ長。SQLite(trigram) は3文字未満を引けない。 */
export function minQueryLength(): number {
  return backend() === 'elasticsearch' ? 1 : 3;
}

export function search(query: string, limit: number, offset: number): Promise<SearchResponse> {
  return backend() === 'elasticsearch'
    ? elasticsearch.search(query, limit, offset)
    : sqlite.search(query, limit, offset);
}

export function getStats(): Promise<Stats> {
  return backend() === 'elasticsearch' ? elasticsearch.getStats() : sqlite.getStats();
}
