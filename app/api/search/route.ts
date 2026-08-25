import { NextRequest, NextResponse } from 'next/server';
import { minQueryLength, search } from '@/lib/search';
import { MAX_PAGE_SIZE, MAX_RESULT_WINDOW, PAGE_SIZE } from '@/types';

// The corpus only changes when the index is rebuilt, so results are safe to cache at the CDN.
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
};

/**
 * Read a bounded integer query parameter. Missing or unparseable values fall back
 * to `fallback` rather than producing NaN, which would reach the SQL bind layer
 * and surface a malformed request as a 500.
 */
function intParam(raw: string | null, fallback: number, min: number, max = Infinity): number {
  const parsed = parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q')?.trim() ?? '';
  const limit = intParam(searchParams.get('limit'), PAGE_SIZE, 1, MAX_PAGE_SIZE);
  // Elasticsearch は from + size が索引の max_result_window を超えると 400 を返すため、
  // 深すぎるページングはエラーにせず窓の端で頭打ちにする。
  const offset = intParam(searchParams.get('offset'), 0, 0, MAX_RESULT_WINDOW - limit - 1);

  // 下限はバックエンド次第。SQLite(trigram) は3文字未満を原理的に引けない。
  const min = minQueryLength();
  if (q.length < min) {
    return NextResponse.json(
      { error: min <= 1 ? '検索する語を入力してください' : `${min}文字以上入力してください` },
      { status: 400 }
    );
  }

  try {
    const result = await search(q, limit, offset);
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: '検索中にエラーが発生しました' }, { status: 500 });
  }
}
