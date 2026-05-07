import { NextResponse } from 'next/server';
import { getTokenByPolicyId } from '@/lib/registry';
import { fetchCurveState } from '@/lib/blockfrost';
import { quoteBuy, quoteSellGross } from '@/lib/curve-math';

// GET /api/quote
//
// Mirrors the on-chain bonding-curve math against the live curve state, so
// agents/builders don't have to re-implement quoteBuy / quoteSellGross.
//
// Query params:
//   policyId   (required)
//   side       'buy' | 'sell'  (required)
//   amount     bigint string. For side=buy, lovelace going IN to the curve.
//              For side=sell, token units going IN to the curve.
//   slippageBps optional, default 50 (0.5%). Returned alongside the raw quote.
//
// Response:
//   {
//     side, policyId, assetUnit,
//     amountIn:           string (input),
//     expectedOut:        string (lovelace for sell, tokens for buy),
//     minOut:             string (expectedOut * (1 - slippageBps/10000)),
//     creatorFeeBps:      number,
//     creatorFeeLovelace: string  (only on buy: bps × adaIn),
//     platformFeeLovelace: '1000000',
//     adaNetLovelace:     string  (only on sell: gross − creator − platform),
//     reserves:           { adaReserve, tokenReserve },
//     graduated:          boolean,
//   }

const PLATFORM_FEE_LOVELACE = 1_000_000n;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const policyId    = searchParams.get('policyId') ?? '';
  const side        = searchParams.get('side');
  const amountStr   = searchParams.get('amount') ?? '';
  const slippageBps = Math.max(0, Math.min(500, Number(searchParams.get('slippageBps') ?? '50')));

  if (!policyId)                          return NextResponse.json({ error: 'policyId required' },           { status: 400 });
  if (side !== 'buy' && side !== 'sell')  return NextResponse.json({ error: 'side must be buy or sell' },    { status: 400 });
  let amount: bigint;
  try { amount = BigInt(amountStr); }
  catch                                   { return NextResponse.json({ error: 'amount must be a bigint string' }, { status: 400 }); }
  if (amount <= 0n)                       return NextResponse.json({ error: 'amount must be positive' },     { status: 400 });

  const meta = await getTokenByPolicyId(policyId);
  if (!meta) return NextResponse.json({ error: 'token not found' }, { status: 404 });

  const assetUnit = `${meta.policyId}${meta.assetName}`;
  const state = await fetchCurveState(meta.curveAddress, assetUnit);
  if (!state) {
    return NextResponse.json({ error: 'curve unreachable or graduated', graduated: !!meta.minswapPoolTxHash }, { status: 409 });
  }

  if (side === 'buy') {
    const expectedOut = quoteBuy(state.adaReserve, state.tokenReserve, amount);
    const minOut      = expectedOut - (expectedOut * BigInt(slippageBps)) / 10_000n;
    const creatorFee  = (amount * BigInt(meta.creatorFeeBps)) / 10_000n;
    return NextResponse.json({
      side, policyId, assetUnit,
      amountIn:           amount.toString(),
      expectedOut:        expectedOut.toString(),
      minOut:             minOut.toString(),
      creatorFeeBps:      meta.creatorFeeBps,
      creatorFeeLovelace: creatorFee.toString(),
      platformFeeLovelace: PLATFORM_FEE_LOVELACE.toString(),
      reserves: {
        adaReserve:   state.adaReserve.toString(),
        tokenReserve: state.tokenReserve.toString(),
      },
      graduated: false,
      slippageBps,
    });
  }

  // sell
  const adaGross    = quoteSellGross(state.adaReserve, state.tokenReserve, amount);
  const creatorFee  = (adaGross * BigInt(meta.creatorFeeBps)) / 10_000n;
  const adaNet      = adaGross - PLATFORM_FEE_LOVELACE - creatorFee;
  const minOut      = adaNet - (adaNet * BigInt(slippageBps)) / 10_000n;
  return NextResponse.json({
    side, policyId, assetUnit,
    amountIn:           amount.toString(),
    expectedOut:        adaGross.toString(),
    minOut:             minOut.toString(),
    creatorFeeBps:      meta.creatorFeeBps,
    creatorFeeLovelace: creatorFee.toString(),
    platformFeeLovelace: PLATFORM_FEE_LOVELACE.toString(),
    adaNetLovelace:     adaNet.toString(),
    reserves: {
      adaReserve:   state.adaReserve.toString(),
      tokenReserve: state.tokenReserve.toString(),
    },
    graduated: false,
    slippageBps,
  });
}
