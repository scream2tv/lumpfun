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

  const res = await fetch(`${BASE}/addresses/${address}/utxos?count=100&order=asc`, {
    headers: { project_id: KEY },
    // 5-second window keeps the polling client light without hiding new
    // orders for too long.
    next: { revalidate: 5 },
  });
  if (res.status === 404) return NextResponse.json([]);
  if (!res.ok)             return NextResponse.json([], { status: 502 });
  const data = await res.json();
  return NextResponse.json(data);
}
