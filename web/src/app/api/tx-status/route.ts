import { NextResponse } from 'next/server';

// Lightweight tx-confirmation lookup. The trade panel polls this after a
// successful CIP-30 submit so it can tell users whether the tx actually
// landed on-chain — Cardano silently drops mempool txs when a competing tx
// consumes the same input first, which leaves Vespr / Eternl showing
// "Pending" indefinitely. Surfacing the outcome lets us retry or warn.
//
// Blockfrost's /txs/{hash} returns 200 once the tx is in a block, 404 while
// it's still in the mempool (or never landed). That's all we need.

const BASE = process.env.BLOCKFROST_BASE_URL ?? 'https://cardano-preprod.blockfrost.io/api/v0';
const KEY  = process.env.BLOCKFROST_PROJECT_ID ?? '';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hash = searchParams.get('hash') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return NextResponse.json({ error: 'invalid hash' }, { status: 400 });
  }

  const res = await fetch(`${BASE}/txs/${hash}`, {
    headers: { project_id: KEY },
    cache: 'no-store',
  });
  if (res.status === 404) return NextResponse.json({ confirmed: false });
  if (!res.ok)             return NextResponse.json({ confirmed: false, error: `blockfrost ${res.status}` });
  const data = await res.json() as { block_height?: number };
  return NextResponse.json({ confirmed: typeof data.block_height === 'number' });
}
