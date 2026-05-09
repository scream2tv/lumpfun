import { NextResponse } from 'next/server';
import { getAllTokens } from '@/lib/registry';
import { fetchFeeAccumulatorStats } from '@/lib/blockfrost';

// Per-token creator-fee accounting.
//
// Why this exists: the on-chain fee accumulator script is parameterised by
// creator_pkh ALONE. Two tokens by the same creator pay into a single
// shared address. The CreatorFeesPanel previously displayed that address's
// raw balance, so $token-A's page mixed in fees from $token-B and any
// other token by the same creator — confusing for a creator who wants to
// know how much one specific token earned.
//
// Approach: lifetime fees per token are computed by summing each trade's
// creator fee output across this token's curve transactions. The on-chain
// pool's claimed/unclaimed split is reported separately (the sweep button
// claims the whole pool — it's not per-token-claimable).

const BASE = process.env.BLOCKFROST_BASE_URL ?? 'https://cardano-preprod.blockfrost.io/api/v0';
const KEY  = process.env.BLOCKFROST_PROJECT_ID ?? '';

// CBOR uint reader, copied from /api/trades. Curve datum = Constr(0, [ada, tokens]).
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

export interface TokenFees {
  policyId:        string;
  ticker:          string;
  /** Lifetime creator fees from THIS token's trades (lovelace). */
  lifetime:        string;
  /** Number of trades counted toward lifetime. */
  tradesCounted:   number;
  /** True if there are likely more trades beyond what we sampled (>=100). */
  truncated:       boolean;
  /** Pool fields are CREATOR-WIDE — the on-chain accumulator is shared
   *  across every token this creator launched. Sweep button at the panel
   *  acts on these, not per-token. Null if the token predates the
   *  accumulator pattern. */
  pool: {
    lifetime:  string;
    claimed:   string;
    unclaimed: string;
  } | null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const policyId = searchParams.get('policyId') ?? '';
  if (!policyId) return NextResponse.json({ error: 'policyId required' }, { status: 400 });

  const tokens = await getAllTokens();
  const meta = tokens.find(t => t.policyId === policyId);
  if (!meta) return NextResponse.json({ error: 'token not found' }, { status: 404 });

  // Walk the curve address's transactions and sum |adaDelta| × bps / 10000
  // for each trade. The 100-tx ceiling matches /api/trades; on tokens with
  // hundreds of trades we'd undercount. Pagination is a follow-up.
  const txsRes = await fetch(
    `${BASE}/addresses/${meta.curveAddress}/transactions?order=asc&count=100`,
    { headers: { project_id: KEY }, next: { revalidate: 30 } },
  );
  if (!txsRes.ok) {
    return NextResponse.json({ error: `blockfrost ${txsRes.status}` }, { status: 502 });
  }
  const txs = await txsRes.json() as Array<{ tx_hash: string }>;

  let lifetime = 0n;
  let counted  = 0;

  for (const tx of txs) {
    const utxoRes = await fetch(`${BASE}/txs/${tx.tx_hash}/utxos`, {
      headers: { project_id: KEY },
      next: { revalidate: 86400 },
    });
    if (!utxoRes.ok) continue;
    const data = await utxoRes.json() as {
      inputs:  Array<{ address: string; inline_datum: string | null }>;
      outputs: Array<{ address: string; inline_datum: string | null }>;
    };
    const curveIn  = data.inputs .find(u => u.address === meta.curveAddress && u.inline_datum);
    const curveOut = data.outputs.find(u => u.address === meta.curveAddress && u.inline_datum);
    if (!curveIn?.inline_datum || !curveOut?.inline_datum) continue;
    const inS  = parseDatum(curveIn.inline_datum);
    const outS = parseDatum(curveOut.inline_datum);
    if (!inS || !outS) continue;
    const adaDelta = outS.ada - inS.ada;
    if (adaDelta === 0n) continue;
    const abs = adaDelta < 0n ? -adaDelta : adaDelta;
    lifetime += (abs * BigInt(meta.creatorFeeBps)) / 10000n;
    counted++;
  }

  // Pool stats (creator-wide) — fed by fetchFeeAccumulatorStats.
  let pool: TokenFees['pool'] = null;
  if (meta.feeAccumulatorAddress) {
    const stats = await fetchFeeAccumulatorStats(meta.feeAccumulatorAddress).catch(() => null);
    if (stats) {
      pool = {
        lifetime:  stats.lifetime.toString(),
        claimed:   stats.claimed.toString(),
        unclaimed: stats.unclaimed.toString(),
      };
    }
  }

  const body: TokenFees = {
    policyId:      meta.policyId,
    ticker:        meta.ticker,
    lifetime:      lifetime.toString(),
    tradesCounted: counted,
    truncated:     txs.length >= 100,
    pool,
  };
  return NextResponse.json(body);
}
