import { NextRequest, NextResponse } from 'next/server';
import { search } from '@/lib/db';

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20'), 1), 50);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0'), 0);

  if (q.length < 3) {
    return NextResponse.json({ error: '3文字以上入力してください' }, { status: 400 });
  }

  try {
    const result = search(q, limit, offset);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: '検索中にエラーが発生しました' }, { status: 500 });
  }
}
