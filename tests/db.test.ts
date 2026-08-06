import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestDb, WORKS, TOTAL_WORKS, TOTAL_CHUNKS } from './helpers/db';
import { search, getStats } from '@/lib/db';

let cleanup: () => void;

beforeAll(async () => {
  const db = await createTestDb();
  cleanup = db.cleanup;
  // lib/db creates its client lazily on first query, so setting this here is enough.
  process.env.TURSO_DATABASE_URL = db.url;
});

afterAll(() => cleanup());

const PAGING_QUERY = 'ページング検証用';

describe('search', () => {
  it('DB-01: マッチするチャンクを返す', async () => {
    const res = await search('月が綺麗', 20, 0);
    expect(res.results).toHaveLength(2);
  });

  it('DB-02: 単語境界に関係なく部分文字列でヒットする', async () => {
    const res = await search('夜は月が', 20, 0);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].snippet).toContain('縁側');
  });

  it('DB-03: snippet がマッチ部分を <mark> で囲む', async () => {
    const res = await search('月が綺麗', 20, 0);
    for (const r of res.results) {
      expect(r.snippet).toContain('<mark>月が綺麗</mark>');
    }
  });

  it('DB-04: context は snippet より広い範囲を返す', async () => {
    const res = await search('目印となる語', 20, 0);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].context.length).toBeGreaterThan(res.results[0].snippet.length);
    expect(res.results[0].context).toContain('<mark>目印となる語</mark>');
  });

  it('DB-05: works と結合して作品情報を返す', async () => {
    const res = await search('縁側に腰', 20, 0);
    expect(res.results[0]).toMatchObject({
      title: WORKS[0].title,
      author: WORKS[0].author,
      card_url: WORKS[0].card_url,
    });
  });

  it('DB-16: 作家別作品リストの URL を返す', async () => {
    const res = await search('縁側に腰', 20, 0);
    expect(res.results[0].author_url).toBe(WORKS[0].author_url);
  });

  it('DB-06: limit の件数だけ返す', async () => {
    const res = await search(PAGING_QUERY, 5, 0);
    expect(res.results).toHaveLength(5);
  });

  it('DB-07: ヒット数が limit を超えると over_limit=true になり limit 件だけ返す', async () => {
    const res = await search(PAGING_QUERY, 5, 0);
    expect(res.over_limit).toBe(true);
    expect(res.results).toHaveLength(5);
  });

  it('DB-08: ヒット数が limit ちょうどなら over_limit=false', async () => {
    const res = await search(PAGING_QUERY, 12, 0);
    expect(res.results).toHaveLength(12);
    expect(res.over_limit).toBe(false);
  });

  it('DB-09: offset でページングでき、前ページと重複しない', async () => {
    const first = await search(PAGING_QUERY, 5, 0);
    const second = await search(PAGING_QUERY, 5, 5);

    expect(second.results).toHaveLength(5);
    const firstSnippets = new Set(first.results.map((r) => r.snippet));
    for (const r of second.results) {
      expect(firstSnippets.has(r.snippet)).toBe(false);
    }
  });

  it('DB-10: ヒット数を超える offset は空の結果を返す', async () => {
    const res = await search(PAGING_QUERY, 5, 100);
    expect(res.results).toEqual([]);
    expect(res.over_limit).toBe(false);
  });

  it('DB-11: ヒットなしは空配列と over_limit=false', async () => {
    const res = await search('存在しない語句', 20, 0);
    expect(res.results).toEqual([]);
    expect(res.over_limit).toBe(false);
  });

  it('DB-12: レスポンスの query に入力クエリをそのまま返す', async () => {
    expect((await search('月が綺麗', 20, 0)).query).toBe('月が綺麗');
  });

  it('DB-13: 二重引用符を含むクエリでも落ちず、リテラルとして一致する', async () => {
    const res = await search('引用符"を', 20, 0);
    expect(res.results).toHaveLength(1);
    expect(res.results[0].snippet).toContain('<mark>');
  });

  it('DB-14: FTS5 の演算子はリテラル扱いになる', async () => {
    // 前方一致演算子として解釈されれば「月が綺麗」の2件にヒットしてしまう。
    expect((await search('月が*', 20, 0)).results).toEqual([]);
    // OR / AND として解釈されれば「月」「星」を含む行にヒットしてしまう。
    expect((await search('月が綺麗 OR 星が', 20, 0)).results).toEqual([]);
    expect((await search('月が綺麗 AND 星が', 20, 0)).results).toEqual([]);
  });
});

describe('search（author_url 列を持たない旧インデックス）', () => {
  it('DB-17: 例外にせず author_url を null として返す', async () => {
    const legacy = await createTestDb({ authorUrl: false });
    const current = process.env.TURSO_DATABASE_URL;
    try {
      // lib/db はクライアントと列の有無をモジュール内にキャッシュするため、
      // 旧スキーマの DB を見せるには読み込み直す必要がある。
      vi.resetModules();
      process.env.TURSO_DATABASE_URL = legacy.url;
      const { search: legacySearch } = await import('@/lib/db');

      const res = await legacySearch('縁側に腰', 20, 0);
      expect(res.results[0]).toMatchObject({
        author: WORKS[0].author,
        author_url: null,
      });
    } finally {
      process.env.TURSO_DATABASE_URL = current;
      legacy.cleanup();
    }
  });
});

describe('getStats', () => {
  it('DB-15: 作品数とチャンク数を返す', async () => {
    expect(await getStats()).toEqual({ works: TOTAL_WORKS, chunks: TOTAL_CHUNKS });
  });
});
