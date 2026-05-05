import { NextResponse } from 'next/server';

const BASE = process.env.BLOCKFROST_BASE_URL ?? 'https://cardano-preprod.blockfrost.io/api/v0';
const KEY  = process.env.BLOCKFROST_PROJECT_ID ?? '';

const VIRTUAL_ADA = 3_000_000_000n;

const BUCKET_SECONDS: Record<string, number> = {
  '5m':  300,
  '15m': 900,
  '1h':  3600,
  'all': 0,
};

export interface Candle {
  t: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// Inline CBOR uint reader (no external deps in API routes)
function readCborUint(hex: string, pos: number): [bigint, number] {
  const b = parseInt(hex.slice(pos, pos + 2), 16);
  if (b <= 0x17) return [BigInt(b), pos + 2];
  if (b === 0x18) return [BigInt(parseInt(hex.slice(pos + 2, pos + 4), 16)), pos + 4];
  if (b === 0x19) return [BigInt(parseInt(hex.slice(pos + 2, pos + 6), 16)), pos + 6];
  if (b === 0x1a) return [BigInt(parseInt(hex.slice(pos + 2, pos + 10), 16)), pos + 10];
  if (b === 0x1b) return [BigInt(parseInt(hex.slice(pos + 2, pos + 18), 16)), pos + 18];
  throw new Error(`unexpected CBOR major: 0x${b.toString(16)}`);
}

function parseDatumPrice(inline_datum: string): number | null {
  try {
    // Strip Constr(0, [...]) prefix: d87982 = Constr 0 with 2 fields
    const body = inline_datum.replace(/^d879[89a-f][0-9a-f]/, '');
    const [ada, p1] = readCborUint(body, 0);
    const [tokens]  = readCborUint(body, p1);
    if (tokens === 0n) return null;
    const priceLovelace = ((ada + VIRTUAL_ADA) * 1_000_000n) / tokens;
    return Number(priceLovelace) / 1_000_000;
  } catch { return null; }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address   = searchParams.get('address') ?? '';
  const asset     = searchParams.get('asset')   ?? '';
  const tfParam   = searchParams.get('timeframe') ?? '15m';
  const timeframe = tfParam in BUCKET_SECONDS ? tfParam : '15m';

  if (!address || !asset) return NextResponse.json([], { status: 400 });

  const txsRes = await fetch(
    `${BASE}/addresses/${address}/transactions?order=asc&count=100`,
    // No cache on tx list — pending trades need to surface immediately.
    { headers: { project_id: KEY }, cache: 'no-store' },
  );
  if (!txsRes.ok) return NextResponse.json([]);
  const txs: Array<{ tx_hash: string; block_time: number }> = await txsRes.json();

  // Resolve each tx's curve output price
  const rawPoints: Array<{ timestamp: number; price: number }> = [];
  for (const tx of txs) {
    const utxoRes = await fetch(`${BASE}/txs/${tx.tx_hash}/utxos`, {
      headers: { project_id: KEY },
      next: { revalidate: 86400 },
    });
    if (!utxoRes.ok) continue;
    const data: {
      outputs: Array<{ address: string; inline_datum: string | null; amount: Array<{ unit: string; quantity: string }> }>;
    } = await utxoRes.json();

    const curveOut = data.outputs.find(
      o => o.address === address && o.inline_datum && o.amount.some(a => a.unit === asset),
    );
    if (!curveOut?.inline_datum) continue;

    const price = parseDatumPrice(curveOut.inline_datum);
    if (price === null) continue;
    rawPoints.push({ timestamp: tx.block_time, price });
  }

  if (rawPoints.length === 0) return NextResponse.json([]);

  const bucketSize = BUCKET_SECONDS[timeframe];

  // 'all' timeframe: one point per tx
  if (bucketSize === 0) {
    const candles: Candle[] = rawPoints.map(p => ({
      t: fmtTime(p.timestamp),
      timestamp: p.timestamp,
      open: p.price, high: p.price, low: p.price, close: p.price,
    }));
    return NextResponse.json(candles);
  }

  // Bucket into OHLC candles
  const buckets = new Map<number, { open: number; high: number; low: number; close: number }>();
  for (const p of rawPoints) {
    const bucket = Math.floor(p.timestamp / bucketSize) * bucketSize;
    const existing = buckets.get(bucket);
    if (!existing) {
      buckets.set(bucket, { open: p.price, high: p.price, low: p.price, close: p.price });
    } else {
      existing.high  = Math.max(existing.high, p.price);
      existing.low   = Math.min(existing.low,  p.price);
      existing.close = p.price;
    }
  }

  const candles: Candle[] = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ts, ohlc]) => ({
      t: fmtTime(ts),
      timestamp: ts,
      ...ohlc,
    }));

  return NextResponse.json(candles);
}

function fmtTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const mo = d.getMonth() + 1;
  const dy = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${mo}/${dy} ${hh}:${mm}`;
}
