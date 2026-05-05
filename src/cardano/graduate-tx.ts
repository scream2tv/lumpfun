import type { LucidEvolution, UTxO } from '@lucid-evolution/lucid';
import { Data, Constr } from '@lucid-evolution/lucid';
import {
  encodeCurveRedeemer,
  decodeCurveDatum,
} from './codec.js';
import {
  computeGraduationQuote,
  assertPriceContinuity,
  MINSWAP,
  POOL_CREATION_DEPOSIT_LOVELACE,
  MIN_LOCKED_LP,
  intSqrtCeil,
} from './graduate.js';
import { MIN_UTXO_LOVELACE } from './config.js';
import type { GraduationResult } from './types.js';

// ── Minswap Pool Datum & Redeemer encoding ────────────────────────────────────
// Based on Minswap v2 on-chain types (github.com/minswap/minswap-dex-v2)

function encodeMinswapPoolDatum(
  policyId: string,
  assetName: string,
  lpPolicyId: string,
  lpAssetName: string,
  totalLiquidity: bigint,
): string {
  return Data.to(
    new Constr(0, [
      // asset_a: ADA represented as empty bytestrings
      new Constr(0, ['', '']),
      // asset_b: the launched token
      new Constr(0, [policyId, assetName]),
      // total_liquidity
      totalLiquidity,
      // reserve_a (ADA) and reserve_b (tokens) will be inferred from value
      // lp_asset
      new Constr(0, [lpPolicyId, lpAssetName]),
      // fee_numerator: 30 (0.3%)
      30n,
      // fee_denominator: 10000
      10000n,
      // trading enabled
      new Constr(1, []),
    ]),
  );
}

function encodeMinswapFactoryRedeemer(
  policyId: string,
  assetName: string,
): string {
  return Data.to(
    new Constr(0, [
      new Constr(0, ['', '']),      // asset_a: ADA
      new Constr(0, [policyId, assetName]), // asset_b: token
    ]),
  );
}

// ── Main graduation tx ────────────────────────────────────────────────────────

export async function graduateToken(
  lucid: LucidEvolution,
  curveAddress: string,
  policyId: string,
  assetName: string,
  bondingCurveValidator: { type: string; script: string },
  creatorAddress: string,
): Promise<GraduationResult> {
  const network = lucid.config().network === 'Mainnet' ? 'Mainnet' : 'Preprod';
  const minswap = network === 'Mainnet' ? MINSWAP.mainnet : MINSWAP.preprod;

  const assetUnit = `${policyId}${assetName}`;

  // Fetch current curve UTxO
  const utxos = await lucid.utxosAt(curveAddress);
  const curveUtxo = utxos.find(u => u.assets[assetUnit] !== undefined);
  if (!curveUtxo || !curveUtxo.datum) throw new Error('Curve UTxO not found');

  const state = decodeCurveDatum(curveUtxo.datum);
  const quote = computeGraduationQuote(state);
  assertPriceContinuity(quote, state);

  const lpPolicyId = minswap.lpPolicyId;
  // LP asset name = Blake2b-256(policy_a + name_a + policy_b + name_b) — computed off-chain
  // For ADA (empty) + token: just use assetName as the LP identifier suffix for preprod testing
  // In production this would need to be the properly computed LP asset name hash
  const lpAssetName = `${policyId}${assetName}`.slice(0, 56);

  const totalLiquidity = quote.estimatedLpTokens + MIN_LOCKED_LP;
  const poolDatum = encodeMinswapPoolDatum(
    policyId,
    assetName,
    lpPolicyId,
    lpAssetName,
    totalLiquidity,
  );
  const factoryRedeemer = encodeMinswapFactoryRedeemer(policyId, assetName);
  const curveRedeemer = encodeCurveRedeemer({ tag: 'Graduate' });

  const tx = lucid
    .newTx()
    .collectFrom([curveUtxo], curveRedeemer)
    .attach.SpendingValidator(bondingCurveValidator as any)
    // Pool creation: send ADA + tokens to the Minswap factory address
    // The factory contract mints LP tokens and creates the pool UTxO
    .pay.ToAddressWithData(
      minswap.factoryAddress,
      { kind: 'inline', value: poolDatum },
      {
        lovelace: quote.adaForPool + POOL_CREATION_DEPOSIT_LOVELACE,
        [assetUnit]: quote.tokensForPool,
      },
    )
    // Creator receives LP tokens minus the permanently locked minimum
    .pay.ToAddress(creatorAddress, {
      lovelace: MIN_UTXO_LOVELACE,
      [`${lpPolicyId}${lpAssetName}`]: quote.estimatedLpTokens,
    });

  const signed = await tx.complete().then(t => t.sign.withWallet().complete());
  const txHash = await signed.submit();

  return {
    txHash,
    minswapPoolId: `${lpPolicyId}${lpAssetName}`,
    lpTokensToCreator: quote.estimatedLpTokens,
  };
}
