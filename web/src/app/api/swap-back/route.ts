// Manual swap-back endpoint: sell a graduated token back to ADA via the
// existing Minswap V2 pool, executed from the treasury wallet using
// @minswap/sdk. Useful when Minswap's frontend hasn't indexed a freshly
// created pool yet — the on-chain pool is fully usable via the SDK regardless.
//
// POST /api/swap-back  { policyId: string, amountTokens?: string }
//   - policyId: token policy id (registry key)
//   - amountTokens: bigint string. Defaults to the entire treasury balance of
//     the token. Send "0" to dry-run quote-only (returns expected ADA out).
//
// Slippage: 5% tolerance is hard-coded; tighten if you care.

import 'server-only';
import { NextResponse } from 'next/server';
import { getTokenByPolicyId } from '@/lib/registry';

const SLIPPAGE_BPS = 500n; // 5%

interface SwapBackBody {
  policyId: string;
  amountTokens?: string;
}

export async function POST(req: Request) {
  let body: SwapBackBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }); }

  if (!body.policyId) return NextResponse.json({ error: 'policyId required' }, { status: 400 });

  const network    = (process.env.CARDANO_NETWORK ?? process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') as 'Mainnet' | 'Preprod';
  const projectId  = process.env.BLOCKFROST_PROJECT_ID ?? '';
  const seedPhrase = process.env.TREASURY_SEED ?? '';
  const baseUrl    = network === 'Mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0';
  if (!projectId)  return NextResponse.json({ error: 'BLOCKFROST_PROJECT_ID not set' }, { status: 500 });
  if (!seedPhrase) return NextResponse.json({ error: 'TREASURY_SEED not set' },          { status: 500 });

  // Registry lookup
  const meta = await getTokenByPolicyId(body.policyId);
  if (!meta) return NextResponse.json({ error: `policyId ${body.policyId} not in registry` }, { status: 404 });
  if (!meta.minswapPoolTxHash) return NextResponse.json({ error: 'token has not graduated to Minswap' }, { status: 400 });

  const assetUnit = `${meta.policyId}${meta.assetName}`;

  // Dynamic-import the Minswap stack — same dance as graduate-server.ts so
  // Turbopack doesn't try to bundle the WASM/legacy-lucid mess at build time.
  const sdk          = await import('@minswap/sdk');
  const blockfrostJs = await import('@blockfrost/blockfrost-js');
  const networkId    = network === 'Mainnet' ? sdk.NetworkId.MAINNET : sdk.NetworkId.TESTNET;

  const tmpLucid = await sdk.getBackendBlockfrostLucidInstance(
    networkId,
    projectId,
    baseUrl,
    network === 'Mainnet'
      ? 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp'
      : 'addr_test1qpu5vlrf4xkxv2qpwngf6cjhtw542ayty80v8dyr49rf5ewvxwdrt70qlcpeeagscasafhffqsxy36t90ldv06wqrk2qum8x5w',
  );
  tmpLucid.selectWalletFromSeed(seedPhrase);
  const treasuryAddr = await tmpLucid.wallet.address();

  const blockFrostApi = new blockfrostJs.BlockFrostAPI({ projectId, network: network === 'Mainnet' ? 'mainnet' : 'preprod' });
  const adapter = new sdk.BlockfrostAdapter(networkId, blockFrostApi);

  const ADA_ASSET  = { policyId: '', tokenName: '' };
  const tokenAsset = { policyId: meta.policyId, tokenName: meta.assetName };

  // Fetch pool — either order works; the SDK normalises A/B internally.
  const pool = await adapter.getV2PoolByPair(ADA_ASSET, tokenAsset);
  if (!pool) return NextResponse.json({ error: 'pool not found on-chain' }, { status: 404 });

  // Identify which side of the pool is TEST and which is ADA.
  // assetA/assetB are concatenated unit strings ("policy" + "name", "lovelace" for ADA).
  const adaUnit   = 'lovelace';
  const tokenUnit = `${meta.policyId}${meta.assetName}`;

  let reserveAda: bigint;
  let reserveToken: bigint;
  let direction: 0 | 1;
  if (pool.assetA === adaUnit && pool.assetB === tokenUnit) {
    reserveAda   = pool.reserveA;
    reserveToken = pool.reserveB;
    direction    = sdk.OrderV2.Direction.B_TO_A; // 0
  } else if (pool.assetA === tokenUnit && pool.assetB === adaUnit) {
    reserveAda   = pool.reserveB;
    reserveToken = pool.reserveA;
    direction    = sdk.OrderV2.Direction.A_TO_B; // 1
  } else {
    return NextResponse.json({ error: `pool A/B mismatch — assetA=${pool.assetA} assetB=${pool.assetB}` }, { status: 500 });
  }

  // Treasury balance — always read for visibility, also used as default amountIn.
  const utxos = await tmpLucid.utxosAt(treasuryAddr);
  const treasuryTokenBalance = utxos.reduce(
    (acc: bigint, u: { assets: Record<string, bigint> }) => acc + (u.assets[assetUnit] ?? 0n), 0n,
  );

  // Decide amountIn: caller-provided, "0" = dry-run quote, omitted = full balance.
  let amountIn: bigint;
  let dryRun = false;
  if (body.amountTokens !== undefined) {
    try { amountIn = BigInt(body.amountTokens); }
    catch { return NextResponse.json({ error: 'amountTokens must be a bigint string' }, { status: 400 }); }
    if (amountIn === 0n) {
      amountIn = treasuryTokenBalance;
      dryRun = true;
    }
  } else {
    amountIn = treasuryTokenBalance;
  }
  if (amountIn === 0n) return NextResponse.json({ error: 'treasury holds 0 of this token' }, { status: 400 });

  // Constant-product quote with Minswap V2's 0.3% fee.
  // out = (in * 9970 * reserveOut) / (reserveIn * 10000 + in * 9970)
  const expectedOut = (amountIn * 9970n * reserveAda) / (reserveToken * 10000n + amountIn * 9970n);
  const minimumOut  = (expectedOut * (10000n - SLIPPAGE_BPS)) / 10000n;

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      treasuryAddr,
      treasuryTokenBalance: treasuryTokenBalance.toString(),
      amountIn:             amountIn.toString(),
      expectedOut:          expectedOut.toString(),
      minimumOut:           minimumOut.toString(),
      direction:            direction === 0 ? 'B_TO_A' : 'A_TO_B',
      pool: { lpAsset: pool.lpAsset, reserveAda: reserveAda.toString(), reserveToken: reserveToken.toString() },
    });
  }

  // Build SWAP_EXACT_IN order
  const dex = new sdk.DexV2(tmpLucid, adapter);
  const txComplete = await dex.createBulkOrdersTx({
    sender: treasuryAddr,
    orderOptions: [{
      type:             sdk.OrderV2.StepType.SWAP_EXACT_IN,
      assetIn:          tokenAsset,
      amountIn,
      minimumAmountOut: minimumOut,
      direction,
      killOnFailed:     false,
      isLimitOrder:     false,
      lpAsset:          pool.lpAsset,
    }],
  });

  const signed = await txComplete.sign().commit();
  const txHash = await signed.submit();

  return NextResponse.json({
    txHash,
    note:        'order submitted to Minswap V2 batcher; settlement happens when batcher picks it up (~minutes on preprod)',
    sender:      treasuryAddr,
    amountIn:    amountIn.toString(),
    expectedOut: expectedOut.toString(),
    minimumOut:  minimumOut.toString(),
    direction:   direction === 0 ? 'B_TO_A' : 'A_TO_B',
    pool: {
      lpAsset:      pool.lpAsset,
      reserveAda:   reserveAda.toString(),
      reserveToken: reserveToken.toString(),
    },
  });
}
