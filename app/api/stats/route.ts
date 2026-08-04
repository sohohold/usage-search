import { NextResponse } from 'next/server';
import { getStats } from '@/lib/db';

export async function GET() {
  try {
    // Stats only change at reindex time; cache to avoid COUNT(*) scans on every visit.
    return NextResponse.json(await getStats(), {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch (err) {
    // Surface the failure instead of reporting an empty index: the header count is
    // decorative, and the client already treats a failed fetch as "no stats yet".
    console.error('Stats error:', err);
    return NextResponse.json({ error: '統計情報の取得に失敗しました' }, { status: 500 });
  }
}
