import { NextResponse } from 'next/server';
import { getStats } from '@/lib/db';

export function GET() {
  try {
    return NextResponse.json(getStats());
  } catch {
    return NextResponse.json({ works: 0, chunks: 0 });
  }
}
