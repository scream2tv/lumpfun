import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Debug endpoint: derives the wallet address from TREASURY_SEED and reports
// its on-chain balance. Use this to verify the seed matches the expected
// NEXT_PUBLIC_TREASURY_ADDRESS and that the wallet is funded before triggering
// any real migration. Server-only — never returns the seed itself.
export async function GET() {
  const seed = process.env.TREASURY_SEED ?? '';
  const projectId = process.env.BLOCKFROST_PROJECT_ID ?? '';
  const network = (process.env.CARDANO_NETWORK ?? process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') as 'Mainnet' | 'Preprod';

  if (!seed)      return NextResponse.json({ error: 'TREASURY_SEED not set' }, { status: 500 });
  if (!projectId) return NextResponse.json({ error: 'BLOCKFROST_PROJECT_ID not set' }, { status: 500 });

  try {
    const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');
    const baseUrl = network === 'Mainnet'
      ? 'https://cardano-mainnet.blockfrost.io/api/v0'
      : 'https://cardano-preprod.blockfrost.io/api/v0';
    const lucid = await Lucid(new Blockfrost(baseUrl, projectId), network);
    lucid.selectWallet.fromSeed(seed);
    const address = await lucid.wallet().address();
    const utxos   = await lucid.wallet().getUtxos();
    let lovelace = 0n;
    for (const u of utxos) lovelace += u.assets.lovelace ?? 0n;

    const expectedAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '';
    return NextResponse.json({
      derivedAddress:   address,
      expectedAddress:  expectedAddress || null,
      addressesMatch:   expectedAddress ? address === expectedAddress : null,
      lovelace:         lovelace.toString(),
      ada:              (Number(lovelace) / 1_000_000).toFixed(2),
      utxoCount:        utxos.length,
      network,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
