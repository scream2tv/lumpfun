import { NextResponse } from 'next/server';
import { getActivitySummary, type ActivitySummary } from '@/lib/midnight/indexer';

const MAX_BLOCKS = 10;

// Re-exported for any external consumer reading the API.
export type MidnightContractActivity = ActivitySummary;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = Number(searchParams.get('blocks') ?? '3');
  const blockCount = Math.min(Math.max(1, Number.isFinite(requested) ? requested : 3), MAX_BLOCKS);

  try {
    const summary = await getActivitySummary(blockCount);
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown indexer error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
