import { NextRequest, NextResponse } from 'next/server';
import { search } from '@/lib/db';
import { MIN_QUERY_LENGTH, PAGE_SIZE } from '@/types';

// The corpus only changes when the index is rebuilt, so results are safe to cache at the CDN.
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? String(PAGE_SIZE)), 1), 50);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0'), 0);

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `${MIN_QUERY_LENGTH}文字以上入力してください` },
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
