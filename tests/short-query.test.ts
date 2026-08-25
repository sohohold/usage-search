/**
 * テスト仕様書 §9「短いクエリ（1〜2文字）」に対応するテスト。
 *
 * Elasticsearch バックエンドに対して実際に索引を引いて検証します。
 * `ELASTICSEARCH_URL` が無い環境（開発者の手元で ES を起動していないとき）は丸ごと
 * スキップされます。CI では `.github/workflows/ci.yml` の service で ES を立てて実行します。
 *
 *   docker compose up -d --wait elasticsearch
 *   ELASTICSEARCH_URL=http://localhost:9200 npm test
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CHUNKS, SHORT_QUERY_CHUNKS } from './helpers/db';
import { createTestIndex, ES_URL } from './helpers/es';
import { resetEsClient } from '@/lib/es/client';
import { search } from '@/lib/search';

const corpus = CHUNKS.map((c) => c.text);

/** コーパス上で実際に部分文字列を含むチャンク数。n-gram 索引の正解値。 */
function countIn(q: string): number {
  return corpus.filter((t) => t.includes(q)).length;
}

let cleanup: () => Promise<void>;
const previous = { backend: process.env.SEARCH_BACKEND, index: process.env.ELASTICSEARCH_INDEX };

describe.skipIf(!ES_URL)('短いクエリ（1〜2文字・Elasticsearch）', () => {
  beforeAll(async () => {
    const idx = await createTestIndex();
    cleanup = idx.cleanup;
    process.env.SEARCH_BACKEND = 'elasticsearch';
    process.env.ELASTICSEARCH_INDEX = idx.index;
    resetEsClient();
  });

  afterAll(async () => {
    process.env.SEARCH_BACKEND = previous.backend;
    process.env.ELASTICSEARCH_INDEX = previous.index;
    resetEsClient();
    await cleanup();
  });

  it('SQ-01: 1文字で検索できる', async () => {
    const res = await search('月', 50, 0);
    expect(res.results.length).toBe(countIn('月'));
    expect(res.results.length).toBeGreaterThan(0);
  });

  it('SQ-02: 2文字で検索できる', async () => {
    const res = await search('月が', 50, 0);
    expect(res.results.length).toBe(countIn('月が'));
  });

  it('SQ-03: チャンク末尾の1文字を取りこぼさない', async () => {
    expect(SHORT_QUERY_CHUNKS.tailChar.endsWith('月')).toBe(true);
    const res = await search('月', 50, 0);
    expect(res.results.some((r) => r.snippet.endsWith('<mark>月</mark>'))).toBe(true);
  });

  it('SQ-04: 1〜4文字で部分文字列と同じ件数を返す', async () => {
    const samples = new Set<string>();
    for (const text of corpus) {
      const chars = Array.from(text);
      for (const len of [1, 2, 3, 4]) {
        if (chars.length < len) continue;
        const i = Math.floor((chars.length - len) / 2);
        samples.add(chars.slice(i, i + len).join(''));
      }
    }
    for (const q of samples) {
      const res = await search(q, 100, 0);
      expect(res.results.length, `クエリ ${JSON.stringify(q)}`).toBe(countIn(q));
    }
  });

  it('SQ-05: 約物・記号1文字で検索できる', async () => {
    for (const q of ['。', '」', '、']) {
      const res = await search(q, 100, 0);
      expect(res.results.length, `クエリ ${q}`).toBe(countIn(q));
    }
  });

  it('SQ-06: 英字1文字は大小を同一視する', async () => {
    const upper = await search('A', 50, 0);
    const lower = await search('a', 50, 0);
    expect(upper.results.length).toBeGreaterThan(0);
    expect(lower.results.map((r) => r.context)).toEqual(upper.results.map((r) => r.context));
  });

  it('SQ-07: サロゲートペアを1文字として扱う', async () => {
    const res = await search('𠮟', 50, 0);
    expect(res.results.length).toBe(countIn('𠮟'));
    expect(res.results[0].snippet).toContain('<mark>𠮟</mark>');
  });

  it('SQ-08: 1文字クエリでも一致した1文字だけをハイライトする', async () => {
    const res = await search('月', 50, 0);
    expect(res.results.length).toBeGreaterThan(0);
    for (const r of res.results) {
      expect(r.snippet).toContain('<mark>月</mark>');
      // 前後の文字を巻き込んでいない。
      expect(r.snippet).not.toMatch(/<mark>.{2,}<\/mark>/);
    }
  });

  it('SQ-09: 1文字クエリのページングが安定している', async () => {
    const all = await search('の', 50, 0);
    expect(all.results.length).toBeGreaterThan(6);

    const first = await search('の', 3, 0);
    const second = await search('の', 3, 3);
    expect(first.results.map((r) => r.context)).toEqual(all.results.slice(0, 3).map((r) => r.context));
    expect(second.results.map((r) => r.context)).toEqual(all.results.slice(3, 6).map((r) => r.context));

    const again = await search('の', 50, 0);
    expect(again.results.map((r) => r.context)).toEqual(all.results.map((r) => r.context));
  });

  it('SQ-11: 高頻度クエリでも limit 件までしか読まない', async () => {
    const res = await search('の', 5, 0);
    expect(res.results).toHaveLength(5);
    expect(res.over_limit).toBe(true);
  });

  it('SQ-12: FTS の演算子や記号をリテラルとして扱う', async () => {
    for (const q of ['*', '"', '(', '^', 'OR']) {
      const res = await search(q, 50, 0);
      expect(res.results.length, `クエリ ${q}`).toBe(countIn(q));
    }
  });

  it('SQ-13: 3文字以上の既存の挙動を壊さない', async () => {
    const res = await search('月が綺麗', 50, 0);
    expect(res.results.length).toBe(countIn('月が綺麗'));
    for (const r of res.results) expect(r.context).toContain('<mark>月が綺麗</mark>');
  });
});
