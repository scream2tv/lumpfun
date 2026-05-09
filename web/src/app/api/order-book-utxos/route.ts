import { NextResponse } from 'next/server';

// Thin proxy that returns all UTxOs at the given address with their inline
// datum. Used by the PendingOrders client component to enumerate the
// connected wallet's pending orders without leaking the Blockfrost project
// ID into the bundle. Cached briefly so frequent re-renders don't hammer
// the indexer.

const BASE = process.env.BLOCKFROST_BASE_URL ?? (
  process.env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0'
);
const KEY = process.env.BLOCKFROST_PROJECT_ID ?? '';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address') ?? '';
  if (!address) return NextResponse.json([], { status: 400 });

  if (!KEY) {
    console.error('[api/order-book-utxos] BLOCKFROST_PROJECT_ID not set — server-side env missing. /api/health for detail.');
    return NextResponse.json([], { status: 502, headers: { 'X-LumpFun-Hint': 'BLOCKFROST_PROJECT_ID missing' } });
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/addresses/${address}/utxos?count=100&order=asc`, {
      headers: { project_id: KEY },
      // 5-second window keeps the polling client light without hiding new
      // orders for too long.
      next: { revalidate: 5 },
    });
  } catch (e) {
    console.error('[api/order-book-utxos] fetch threw:', e instanceof Error ? e.message : String(e));
    return NextResponse.json([], { status: 502, headers: { 'X-LumpFun-Hint': 'blockfrost unreachable' } });
  }

  // 404 = address never seen on chain. Treat as empty (legitimately no
  // orders) — same as how Blockfrost reports a fresh address.
  if (res.status === 404) return NextResponse.json([]);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[api/order-book-utxos] blockfrost ${res.status}: ${body.slice(0, 200)}`);
    return NextResponse.json([], { status: 502, headers: { 'X-LumpFun-Hint': `blockfrost ${res.status}` } });
  }
  const data = await res.json();
  return NextResponse.json(data);
}
