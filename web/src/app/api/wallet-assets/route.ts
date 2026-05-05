import { NextResponse } from 'next/server';
import { getAllTokens } from '@/lib/registry';
import type { TokenMeta } from '@/lib/types';

// Aggregate non-ADA assets held by an address, plus deep-link hints for any
// asset that appears in the LumpFun token registry.
//
//   GET /api/wallet-assets?address=addr1...
//
// Response: { assets: Array<{ unit, quantity, registry?: { policyId, assetName, ticker, name, imageUri? } }> }

interface AssetRow {
  unit:     string;
  quantity: string;
  registry?: {
    policyId:  string;
    assetName: string;
    ticker:    string;
    name:      string;
    imageUri?: string;
  };
}

const NETWORK = (process.env.CARDANO_NETWORK ?? process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') as 'Mainnet' | 'Preprod';
const BASE = NETWORK === 'Mainnet'
  ? 'https://cardano-mainnet.blockfrost.io/api/v0'
  : 'https://cardano-preprod.blockfrost.io/api/v0';
const KEY = process.env.BLOCKFROST_PROJECT_ID ?? '';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address') ?? '';
  if (!address) return NextResponse.json({ error: 'address required' }, { status: 400 });
  if (!KEY)     return NextResponse.json({ error: 'BLOCKFROST_PROJECT_ID not set' }, { status: 500 });

  // Blockfrost may return 404 if the address has never appeared on-chain;
  // surface as an empty list so the UI doesn't error out for fresh wallets.
  const res = await fetch(`${BASE}/addresses/${address}`, {
    headers: { project_id: KEY },
    next: { revalidate: 30 },
  });
  if (res.status === 404) return NextResponse.json({ assets: [] });
  if (!res.ok) return NextResponse.json({ error: `blockfrost ${res.status}` }, { status: 502 });

  const data: { amount: Array<{ unit: string; quantity: string }> } = await res.json();
  const nonAda = data.amount.filter(a => a.unit !== 'lovelace');
  if (nonAda.length === 0) return NextResponse.json({ assets: [] });

  // Cross-reference with the registry so each LumpFun-launched holding gets a
  // deep-link payload. Unknown assets render as raw policy/name.
  let registry: TokenMeta[] = [];
  try { registry = await getAllTokens(); } catch { /* best-effort */ }
  const byUnit = new Map<string, TokenMeta>();
  for (const t of registry) byUnit.set(`${t.policyId}${t.assetName}`, t);

  const assets: AssetRow[] = nonAda.map(a => {
    const meta = byUnit.get(a.unit);
    return {
      unit: a.unit,
      quantity: a.quantity,
      registry: meta && {
        policyId:  meta.policyId,
        assetName: meta.assetName,
        ticker:    meta.ticker,
        name:      meta.name,
        imageUri:  meta.imageUri,
      },
    };
  });

  // Sort: registry tokens first (highest quantity), unknown last.
  assets.sort((a, b) => {
    if (!!a.registry !== !!b.registry) return a.registry ? -1 : 1;
    const aq = BigInt(a.quantity);
    const bq = BigInt(b.quantity);
    return aq > bq ? -1 : aq < bq ? 1 : 0;
  });

  return NextResponse.json({ assets });
}
