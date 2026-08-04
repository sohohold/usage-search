import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getStats } from '@/lib/db';
import { GET } from '@/app/api/stats/route';

vi.mock('@/lib/db', () => ({ search: vi.fn(), getStats: vi.fn() }));

const getStatsMock = vi.mocked(getStats);

const EXPECTED_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';

beforeEach(() => {
  getStatsMock.mockReset();
  getStatsMock.mockResolvedValue({ works: 2, chunks: 17 });
});

describe('GET /api/stats', () => {
  it('API-20: 作品数とチャンク数を 200 で返す', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ works: 2, chunks: 17 });
  });

  it('API-21: 成功時は CDN キャッシュヘッダを付ける', async () => {
    expect((await GET()).headers.get('Cache-Control')).toBe(EXPECTED_CACHE);
  });

  it('API-22: DB 障害を握り潰さず 500 を返し、キャッシュもさせない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getStatsMock.mockRejectedValue(new Error('db down'));

    const res = await GET();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: '統計情報の取得に失敗しました' });
    expect(res.headers.get('Cache-Control')).not.toBe(EXPECTED_CACHE);
  });
});
