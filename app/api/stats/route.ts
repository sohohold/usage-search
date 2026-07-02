import { NextResponse } from 'next/server';
import { getStats } from '@/lib/db';

export async function GET() {
  try {
    // Stats only change at reindex time; cache to avoid COUNT(*) scans on every visit.
    return NextResponse.json(await getStats(), {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch {
    return NextResponse.json({ works: 0, chunks: 0 });
  }
}
