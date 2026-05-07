import { NextResponse } from 'next/server';
import { fetchFeeAccumulatorStats } from '@/lib/blockfrost';

// GET /api/fee-accumulator?address=<addr>
//
// Returns lifetime accounting for a per-launch creator-fee accumulator:
//   unclaimed — lovelace currently sitting in the script address
//   claimed   — lovelace ever swept out by the creator
//   lifetime  — total lovelace ever paid in (== unclaimed + claimed)
//
// Used by the client-side fees panel to refresh both numbers without a
// full page reload.

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!address) return NextResponse.json({ error: 'address required' }, { status: 400 });

  const stats = await fetchFeeAccumulatorStats(address).catch(() => null);
  if (!stats) return NextResponse.json({ unclaimed: '0', claimed: '0', lifetime: '0' });

  return NextResponse.json({
    unclaimed: stats.unclaimed.toString(),
    claimed:   stats.claimed.toString(),
    lifetime:  stats.lifetime.toString(),
  });
}
