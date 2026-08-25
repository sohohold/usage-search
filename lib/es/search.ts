import type { SearchResponse, Stats } from '@/types';
import { getEsClient, searchIndex } from './client';
import { buildSearchBody, queryField, toSearchResult, type ChunkSource } from './query';

/**
 * Elasticsearch バックエンドの検索。返す形は SQLite 版（lib/db.ts）と同じで、
 * Route Handler から先は backend を意識しない。
 */
export async function search(query: string, limit: number, offset: number): Promise<SearchResponse> {
  const field = queryField(query);
  const res = await getEsClient().search<ChunkSource>({
    index: searchIndex(),
    ...buildSearchBody(query, limit, offset),
  });

  const hits = res.hits.hits;
  const hasMore = hits.length > limit;
  const results = (hasMore ? hits.slice(0, limit) : hits).map((hit) => toSearchResult(hit, field));

  return { query, over_limit: hasMore, results };
}

export async function getStats(): Promise<Stats> {
  const res = await getEsClient().search<ChunkSource>({
    index: searchIndex(),
    size: 0,
    track_total_hits: true,
    // 作品数は基数集計。precision_threshold を作品数より大きく取れば実質正確に出る。
    aggs: { works: { cardinality: { field: 'work_id', precision_threshold: 40_000 } } },
  });

  const total = res.hits.total;
  const chunks = typeof total === 'number' ? total : (total?.value ?? 0);
  const works = (res.aggregations?.works as { value?: number } | undefined)?.value ?? 0;

  return { works, chunks };
}
