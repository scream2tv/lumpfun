import { NextResponse } from 'next/server';
import { fetchRecentTrades, type Trade } from '@/lib/midnight/trades';

export interface TradesResponse {
  contractAddress: string;
  trades: Trade[];
  fetchedAt: number;
}

const MAX_LIMIT = 50;
const MAX_BLOCKS_BACK = 20000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(1, Number(searchParams.get('limit') ?? '25') || 25), MAX_LIMIT);
  const blocksBack = Math.min(
    Math.max(100, Number(searchParams.get('blocksBack') ?? '1000') || 1000),
    MAX_BLOCKS_BACK,
  );

  try {
    const trades = await fetchRecentTrades(address, limit, blocksBack);
    return NextResponse.json({
      contractAddress: address,
      trades,
      fetchedAt: Date.now(),
      blocksBack,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
