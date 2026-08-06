import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { search } from '@/lib/db';
import { GET } from '@/app/api/search/route';
import { MIN_QUERY_LENGTH, PAGE_SIZE, type SearchResponse } from '@/types';

vi.mock('@/lib/db', () => ({ search: vi.fn(), getStats: vi.fn() }));

const searchMock = vi.mocked(search);

const EXPECTED_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';

function response(query = 'テスト'): SearchResponse {
  return {
    query,
    over_limit: false,
    results: [
      {
        title: 'こころ',
        author: '夏目　漱石',
        author_url: 'https://www.aozora.gr.jp/index_pages/person148.html',
        card_url: 'https://example.com/cards/card773.html',
        snippet: 'その夜は<mark>月が綺麗</mark>で',
        context: 'その夜は<mark>月が綺麗</mark>で、私は縁側に腰を下ろしていた。',
      },
    ],
  };
}

/** Call the route handler with a query string, e.g. '?q=abc&limit=5'. */
function get(queryString: string) {
  return GET(new NextRequest(`http://localhost:3000/api/search${queryString}`));
}

beforeEach(() => {
  searchMock.mockReset();
  searchMock.mockResolvedValue(response());
});

describe('GET /api/search', () => {
  it('API-01: q 未指定は 400 とメッセージを返し、検索しない', async () => {
    const res = await get('');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: `${MIN_QUERY_LENGTH}文字以上入力してください`,
    });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('API-02: 2文字のクエリは 400', async () => {
    const res = await get('?q=ab');
    expect(res.status).toBe(400);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('API-03: 3文字のクエリは 200', async () => {
    expect((await get('?q=abc')).status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith('abc', PAGE_SIZE, 0);
  });

  it('API-04: 前後の空白を除くと3文字未満なら 400', async () => {
    const res = await get(`?q=${encodeURIComponent('  あ  ')}`);
    expect(res.status).toBe(400);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('API-05: 全角空白を除いた語で検索する', async () => {
    searchMock.mockResolvedValue(response('東京の街'));
    const res = await get(`?q=${encodeURIComponent('　東京の街　')}`);

    expect(res.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith('東京の街', PAGE_SIZE, 0);
    await expect(res.json()).resolves.toMatchObject({ query: '東京の街' });
  });

  it('API-06: limit 未指定は既定値を使う', async () => {
    await get('?q=abc');
    expect(searchMock).toHaveBeenCalledWith('abc', PAGE_SIZE, 0);
  });

  it('API-07: limit は 50 を上限に丸める', async () => {
    await get('?q=abc&limit=100');
    expect(searchMock).toHaveBeenCalledWith('abc', 50, 0);
  });

  it('API-08: limit は 1 を下限に丸める', async () => {
    await get('?q=abc&limit=0');
    expect(searchMock).toHaveBeenCalledWith('abc', 1, 0);

    searchMock.mockClear();
    await get('?q=abc&limit=-5');
    expect(searchMock).toHaveBeenCalledWith('abc', 1, 0);
  });

  it('API-09: 数値でない limit は既定値にフォールバックして 200 を返す', async () => {
    const res = await get('?q=abc&limit=abc');
    expect(res.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith('abc', PAGE_SIZE, 0);
  });

  it('API-10: 数値でない offset は 0 にフォールバックして 200 を返す', async () => {
    const res = await get('?q=abc&offset=xyz');
    expect(res.status).toBe(200);
    expect(searchMock).toHaveBeenCalledWith('abc', PAGE_SIZE, 0);
  });

  it('API-11: 負の offset は 0 に丸める', async () => {
    await get('?q=abc&offset=-5');
    expect(searchMock).toHaveBeenCalledWith('abc', PAGE_SIZE, 0);
  });

  it('API-12: 成功時は CDN キャッシュヘッダを付ける', async () => {
    expect((await get('?q=abc')).headers.get('Cache-Control')).toBe(EXPECTED_CACHE);
  });

  it('API-13: エラー応答はキャッシュさせない', async () => {
    expect((await get('?q=ab')).headers.get('Cache-Control')).not.toBe(EXPECTED_CACHE);

    searchMock.mockRejectedValue(new Error('db down'));
    expect((await get('?q=abc')).headers.get('Cache-Control')).not.toBe(EXPECTED_CACHE);
  });

  it('API-14: 検索が例外を投げたら 500 とエラーメッセージを返す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    searchMock.mockRejectedValue(new Error('db down'));

    const res = await get('?q=abc');
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: '検索中にエラーが発生しました' });
  });

  it('API-15: 成功レスポンスが SearchResponse の形をしている', async () => {
    const body = (await (await get('?q=abc')).json()) as SearchResponse;

    expect(Object.keys(body).sort()).toEqual(['over_limit', 'query', 'results']);
    expect(Object.keys(body.results[0]).sort()).toEqual([
      'author',
      'author_url',
      'card_url',
      'context',
      'snippet',
      'title',
    ]);
  });
});
