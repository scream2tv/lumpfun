import { NextResponse } from 'next/server';

const BASE = process.env.BLOCKFROST_BASE_URL ?? 'https://cardano-preprod.blockfrost.io/api/v0';
const KEY  = process.env.BLOCKFROST_PROJECT_ID ?? '';

export interface TradeEntry {
  txHash: string;
  type: 'buy' | 'sell';
  adaDelta: string;
  tokenDelta: string;
  trader: string;
  blockTime: number;
}

function readCborUint(hex: string, pos: number): [bigint, number] {
  const b = parseInt(hex.slice(pos, pos + 2), 16);
  if (b <= 0x17) return [BigInt(b), pos + 2];
  if (b === 0x18) return [BigInt(parseInt(hex.slice(pos + 2, pos + 4), 16)), pos + 4];
  if (b === 0x19) return [BigInt(parseInt(hex.slice(pos + 2, pos + 6), 16)), pos + 6];
  if (b === 0x1a) return [BigInt(parseInt(hex.slice(pos + 2, pos + 10), 16)), pos + 10];
  if (b === 0x1b) return [BigInt(parseInt(hex.slice(pos + 2, pos + 18), 16)), pos + 18];
  throw new Error('bad cbor uint');
}

function parseDatum(hex: string): { ada: bigint; tokens: bigint } | null {
  try {
    const body = hex.replace(/^d879[89a-f][0-9a-f]/, '');
    const [ada, p1] = readCborUint(body, 0);
    const [tokens]  = readCborUint(body, p1);
    return { ada, tokens };
  } catch { return null; }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address') ?? '';
  const asset   = searchParams.get('asset')   ?? '';

  if (!address || !asset) return NextResponse.json([], { status: 400 });

  const txsRes = await fetch(
    `${BASE}/addresses/${address}/transactions?order=desc&count=25`,
    { headers: { project_id: KEY }, cache: 'no-store' },
  );
  if (!txsRes.ok) return NextResponse.json([]);
  const txs: Array<{ tx_hash: string; block_time: number }> = await txsRes.json();

  const trades: TradeEntry[] = [];

  for (const tx of txs) {
    const utxoRes = await fetch(`${BASE}/txs/${tx.tx_hash}/utxos`, {
      headers: { project_id: KEY },
      next: { revalidate: 86400 },
    });
    if (!utxoRes.ok) continue;
    const data: {
      inputs:  Array<{ address: string; inline_datum: string | null; amount: Array<{ unit: string; quantity: string }> }>;
      outputs: Array<{ address: string; inline_datum: string | null; amount: Array<{ unit: string; quantity: string }> }>;
    } = await utxoRes.json();

    // Find the curve input and output datums
    const curveIn  = data.inputs.find(u  => u.address === address && u.inline_datum);
    const curveOut = data.outputs.find(u => u.address === address && u.inline_datum);
    if (!curveIn?.inline_datum || !curveOut?.inline_datum) continue;

    const inState  = parseDatum(curveIn.inline_datum);
    const outState = parseDatum(curveOut.inline_datum);
    if (!inState || !outState) continue;

    // Direction: buy = more ada in curve, sell = less ada in curve
    const adaDelta    = outState.ada    - inState.ada;    // positive = buy
    const tokenDelta  = inState.tokens  - outState.tokens; // positive = buy (tokens left curve)
    if (adaDelta === 0n) continue;

    const type: 'buy' | 'sell' = adaDelta > 0n ? 'buy' : 'sell';

    // Trader = the wallet that signed and paid for the tx — i.e. one of the
    // non-curve inputs. Picking the *output* would land on the treasury or
    // creator-fee output (those come first in the curve→treasury→creator→
    // buyer ordering), which is exactly the bug we just had: every row showed
    // the treasury address. Use the first non-curve input instead — that's
    // the buyer/seller's own UTxO funding the tx.
    const traderIn = data.inputs.find(i => i.address !== address);
    const trader = traderIn?.address ?? 'unknown';

    trades.push({
      txHash:     tx.tx_hash,
      type,
      adaDelta:   (adaDelta < 0n ? -adaDelta : adaDelta).toString(),
      tokenDelta: (tokenDelta < 0n ? -tokenDelta : tokenDelta).toString(),
      trader,
      blockTime:  tx.block_time,
    });
  }

  return NextResponse.json(trades);
}
