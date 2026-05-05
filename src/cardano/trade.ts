import { Constr } from '@lucid-evolution/lucid';
import type { LucidEvolution, UTxO } from '@lucid-evolution/lucid';
import {
  encodeCurveDatum,
  encodeCurveRedeemer,
  decodeCurveDatum,
} from './codec.js';
import { computeBuyFees, computeSellFees } from './fees.js';
import { quoteBuy, quoteSellGross, applyBuy, applySell } from './curve.js';
import { MIN_UTXO_LOVELACE } from './config.js';
import type { CurveUtxo, TradeResult } from './types.js';

// ── UTxO resolution ───────────────────────────────────────────────────────────

export async function fetchCurveUtxo(
  lucid: LucidEvolution,
  curveAddress: string,
  policyId: string,
  assetName: string,
): Promise<CurveUtxo> {
  const utxos = await lucid.utxosAt(curveAddress);
  const assetUnit = `${policyId}${assetName}`;
  const utxo = utxos.find(u => u.assets[assetUnit] !== undefined);
  if (!utxo) throw new Error(`No curve UTxO found at ${curveAddress} for ${assetUnit}`);
  if (!utxo.datum) throw new Error('Curve UTxO missing inline datum');

  const datum = decodeCurveDatum(utxo.datum);
  return {
    txHash: utxo.txHash,
    outputIndex: utxo.outputIndex,
    datum,
    lovelace: utxo.assets.lovelace,
    tokens: utxo.assets[assetUnit],
    policyId,
    assetName,
  };
}

// ── Buy ───────────────────────────────────────────────────────────────────────

export async function buyTokens(
  lucid: LucidEvolution,
  curveUtxo: CurveUtxo,
  adaIn: bigint,         // lovelace the user wants to spend on tokens
  slippageBps: number,   // e.g. 50 = 0.5%
  creatorFeeBps: number, // 0–200; same per-curve param used by validate_buy
  bondingCurveValidator: { type: string; script: string },
  treasuryAddress: string,
  creatorAddress: string,
): Promise<TradeResult> {
  const fees = computeBuyFees(adaIn, creatorFeeBps);
  const adaForCurve = adaIn; // platform + creator fees come on top from wallet

  const expectedOut = quoteBuy(curveUtxo.datum, adaForCurve);
  const minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10000n;
  if (minOut < 1n) throw new Error('Buy amount too small');

  const { state: newState, tokensOut } = applyBuy(curveUtxo.datum, adaForCurve);

  const assetUnit = `${curveUtxo.policyId}${curveUtxo.assetName}`;
  const redeemer = encodeCurveRedeemer({ tag: 'Buy', minOut });
  const newDatum = encodeCurveDatum(newState);

  const curveInput: UTxO = {
    txHash: curveUtxo.txHash,
    outputIndex: curveUtxo.outputIndex,
    assets: {
      lovelace: curveUtxo.lovelace,
      [assetUnit]: curveUtxo.tokens,
    },
    address: await resolveScriptAddress(lucid, bondingCurveValidator),
    datum: encodeCurveDatum(curveUtxo.datum),
    datumHash: undefined,
    scriptRef: undefined,
  };

  const walletAddress = await lucid.wallet().address();

  const tx = lucid
    .newTx()
    .collectFrom([curveInput], redeemer)
    .attach.SpendingValidator(bondingCurveValidator as any)
    .pay.ToAddressWithData(
      curveInput.address,
      { kind: 'inline', value: newDatum },
      {
        lovelace: curveUtxo.lovelace + adaForCurve,
        [assetUnit]: curveUtxo.tokens - tokensOut,
      },
    )
    .pay.ToAddress(treasuryAddress, { lovelace: fees.platformFee });
  if (fees.creatorFee > 0n) {
    tx.pay.ToAddress(creatorAddress, { lovelace: fees.creatorFee });
  }
  tx.pay.ToAddress(walletAddress, {
    lovelace: MIN_UTXO_LOVELACE,
    [assetUnit]: tokensOut,
  });

  const signed = await tx.complete().then(t => t.sign.withWallet().complete());
  const txHash = await signed.submit();

  return { txHash, amount: tokensOut };
}

// ── Sell ──────────────────────────────────────────────────────────────────────

export async function sellTokens(
  lucid: LucidEvolution,
  curveUtxo: CurveUtxo,
  tokensIn: bigint,
  slippageBps: number,
  creatorFeeBps: number,
  bondingCurveValidator: { type: string; script: string },
  treasuryAddress: string,
  creatorAddress: string,
): Promise<TradeResult> {
  const grossAda = quoteSellGross(curveUtxo.datum, tokensIn);
  const fees = computeSellFees(grossAda, creatorFeeBps);
  const minOut = fees.adaNet - (fees.adaNet * BigInt(slippageBps)) / 10000n;

  const { state: newState } = applySell(curveUtxo.datum, tokensIn);

  const assetUnit = `${curveUtxo.policyId}${curveUtxo.assetName}`;
  const redeemer = encodeCurveRedeemer({ tag: 'Sell', minOut });
  const newDatum = encodeCurveDatum(newState);

  const curveInput: UTxO = {
    txHash: curveUtxo.txHash,
    outputIndex: curveUtxo.outputIndex,
    assets: {
      lovelace: curveUtxo.lovelace,
      [assetUnit]: curveUtxo.tokens,
    },
    address: await resolveScriptAddress(lucid, bondingCurveValidator),
    datum: encodeCurveDatum(curveUtxo.datum),
    datumHash: undefined,
    scriptRef: undefined,
  };

  const walletAddress = await lucid.wallet().address();

  const tx = lucid
    .newTx()
    .collectFrom([curveInput], redeemer)
    .attach.SpendingValidator(bondingCurveValidator as any)
    .pay.ToAddressWithData(
      curveInput.address,
      { kind: 'inline', value: newDatum },
      {
        lovelace: curveUtxo.lovelace - grossAda,
        [assetUnit]: curveUtxo.tokens + tokensIn,
      },
    )
    .pay.ToAddress(treasuryAddress, { lovelace: fees.platformFee });
  if (fees.creatorFee > 0n) {
    tx.pay.ToAddress(creatorAddress, { lovelace: fees.creatorFee });
  }
  tx.pay.ToAddress(walletAddress, { lovelace: fees.adaNet });

  const signed = await tx.complete().then(t => t.sign.withWallet().complete());
  const txHash = await signed.submit();

  return { txHash, amount: fees.adaNet };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveScriptAddress(
  lucid: LucidEvolution,
  validator: { type: string; script: string },
): Promise<string> {
  const network = lucid.config().network === 'Mainnet' ? 'Mainnet' : 'Preprod';
  const { validatorToAddress } = await import('@lucid-evolution/lucid');
  return validatorToAddress(network, validator as any);
}
