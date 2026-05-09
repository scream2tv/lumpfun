import type { LucidEvolution, UTxO } from '@lucid-evolution/lucid';
import { Data } from '@lucid-evolution/lucid';
import {
  encodeOrderRedeemer,
  encodeCurveRedeemer,
  encodeCurveDatum,
  decodeOrderDatum,
  decodeCurveDatum,
} from './codec.js';
import { quoteBuy, quoteSellGross, applyBuy, applySell } from './curve.js';
import { computeSellFees } from './fees.js';
import { PLATFORM_FEE_LOVELACE, MIN_UTXO_LOVELACE } from './config.js';
import type { OrderDatum, CurveDatum } from './types.js';
import { ORDER_BOOK_CBOR } from './scripts.js';
import {
  applyDoubleCborEncoding,
  validatorToAddress,
  credentialToAddress,
} from '@lucid-evolution/lucid';

export interface BatcherConfig {
  /** Address of the curve UTxO being serviced */
  curveAddress: string;
  /** Address of the order book contract */
  orderBookAddress: string;
  policyId: string;
  assetName: string;
  creatorFeeBps: number;
  creatorAddress: string;
  treasuryAddress: string;
  bondingCurveValidator: { type: string; script: string };
}

export interface BatchResult {
  processed: number;
  txHashes: string[];
  skipped: number;
}

/** Fetch all pending orders for a given token from the order book contract. */
export async function fetchPendingOrders(
  lucid: LucidEvolution,
  orderBookAddress: string,
  policyId: string,
  assetName: string,
): Promise<Array<{ utxo: UTxO; order: OrderDatum }>> {
  const utxos = await lucid.utxosAt(orderBookAddress);
  const results: Array<{ utxo: UTxO; order: OrderDatum }> = [];

  for (const utxo of utxos) {
    if (!utxo.datum) continue;
    try {
      const order = decodeOrderDatum(utxo.datum);
      if (order.curvePolicyId === policyId && order.curveAssetName === assetName) {
        results.push({ utxo, order });
      }
    } catch {
      // Not a valid OrderDatum for this token — skip
    }
  }

  return results;
}

/** Fetch the single curve UTxO for the given token. */
async function fetchCurveUtxoRaw(
  lucid: LucidEvolution,
  curveAddress: string,
  policyId: string,
  assetName: string,
): Promise<{ utxo: UTxO; datum: CurveDatum }> {
  const assetUnit = `${policyId}${assetName}`;
  const utxos = await lucid.utxosAt(curveAddress);
  const utxo = utxos.find(u => u.assets[assetUnit] !== undefined);
  if (!utxo || !utxo.datum) throw new Error('Curve UTxO not found');
  return { utxo, datum: decodeCurveDatum(utxo.datum) };
}

/**
 * Execute a single pending order against the curve.
 * Returns the tx hash, or null if the order cannot be filled (slippage exceeded).
 */
async function executeOrder(
  lucid: LucidEvolution,
  config: BatcherConfig,
  curveUtxo: UTxO,
  curveDatum: CurveDatum,
  orderUtxo: UTxO,
  order: OrderDatum,
): Promise<string | null> {
  const assetUnit = `${config.policyId}${config.assetName}`;
  const orderRedeemer = encodeOrderRedeemer('Execute');
  const network = lucid.config().network === 'Mainnet' ? 'Mainnet' : 'Preprod';
  // Pay trade outputs back to the user's full base address when the order
  // datum carries a stake credential (new schema). Falls through to an
  // enterprise address for legacy orders without one.
  const ownerAddress = order.ownerStake
    ? credentialToAddress(
        network,
        { type: 'Key', hash: order.ownerPkh },
        { type: 'Key', hash: order.ownerStake },
      )
    : credentialToAddress(network, { type: 'Key', hash: order.ownerPkh });

  if (order.action === 'Buy') {
    const adaIn = order.amount;
    const tokensOut = quoteBuy(curveDatum, adaIn);

    if (tokensOut < order.minOut) return null; // slippage check

    const { state: newState } = applyBuy(curveDatum, adaIn);
    const curveRedeemer = encodeCurveRedeemer({ tag: 'Buy', minOut: order.minOut });
    const newDatum = encodeCurveDatum(newState);

    const tx = lucid
      .newTx()
      .collectFrom([orderUtxo], orderRedeemer)
      .collectFrom([curveUtxo], curveRedeemer)
      .attach.SpendingValidator(config.bondingCurveValidator as any)
      .pay.ToAddressWithData(
        config.curveAddress,
        { kind: 'inline', value: newDatum },
        {
          lovelace: curveUtxo.assets.lovelace + adaIn,
          [assetUnit]: (curveUtxo.assets[assetUnit] ?? 0n) - tokensOut,
        },
      )
      // Platform fee from the order's locked ADA (order locked adaIn + platform fee)
      .pay.ToAddress(config.treasuryAddress, { lovelace: PLATFORM_FEE_LOVELACE })
      // Tokens to order owner
      .pay.ToAddress(ownerAddress, {
        lovelace: MIN_UTXO_LOVELACE,
        [assetUnit]: tokensOut,
      });

    const signed = await tx.complete().then(t => t.sign.withWallet().complete());
    return signed.submit();
  } else {
    // Sell
    const tokensIn = order.amount;
    const grossAda = quoteSellGross(curveDatum, tokensIn);
    const fees = computeSellFees(grossAda, config.creatorFeeBps);

    if (fees.adaNet < order.minOut) return null;

    const { state: newState } = applySell(curveDatum, tokensIn);
    const curveRedeemer = encodeCurveRedeemer({ tag: 'Sell', minOut: order.minOut });
    const newDatum = encodeCurveDatum(newState);

    const tx = lucid
      .newTx()
      .collectFrom([orderUtxo], orderRedeemer)
      .collectFrom([curveUtxo], curveRedeemer)
      .attach.SpendingValidator(config.bondingCurveValidator as any)
      .pay.ToAddressWithData(
        config.curveAddress,
        { kind: 'inline', value: newDatum },
        {
          lovelace: curveUtxo.assets.lovelace - grossAda,
          [assetUnit]: (curveUtxo.assets[assetUnit] ?? 0n) + tokensIn,
        },
      )
      .pay.ToAddress(config.treasuryAddress, { lovelace: fees.platformFee });
    if (fees.creatorFee > 0n) {
      tx.pay.ToAddress(config.creatorAddress, { lovelace: fees.creatorFee });
    }
    tx.pay.ToAddress(ownerAddress, { lovelace: fees.adaNet });

    const signed = await tx.complete().then(t => t.sign.withWallet().complete());
    return signed.submit();
  }
}

/**
 * Run one batch cycle: fetch the curve UTxO and all pending orders, then
 * process them one by one (sequentially — each order consumes the updated curve).
 */
export async function runBatchCycle(
  lucid: LucidEvolution,
  config: BatcherConfig,
): Promise<BatchResult> {
  const orders = await fetchPendingOrders(
    lucid,
    config.orderBookAddress,
    config.policyId,
    config.assetName,
  );

  if (orders.length === 0) return { processed: 0, txHashes: [], skipped: 0 };

  const txHashes: string[] = [];
  let skipped = 0;

  // Re-fetch curve state before each order (it changes after every execution)
  for (const { utxo: orderUtxo, order } of orders) {
    const { utxo: curveUtxo, datum: curveDatum } = await fetchCurveUtxoRaw(
      lucid,
      config.curveAddress,
      config.policyId,
      config.assetName,
    );

    try {
      const txHash = await executeOrder(
        lucid, config, curveUtxo, curveDatum, orderUtxo, order,
      );
      if (txHash) {
        txHashes.push(txHash);
        // Wait for confirmation before processing the next order so the curve
        // UTxO is available for the subsequent spend.
        await lucid.awaitTx(txHash);
      } else {
        skipped++;
      }
    } catch (err) {
      // Log but don't abort — continue with remaining orders
      console.error(`Batcher: failed to execute order ${orderUtxo.txHash}#${orderUtxo.outputIndex}:`, err);
      skipped++;
    }
  }

  return { processed: txHashes.length, txHashes, skipped };
}

/**
 * Cancel an order — called by the order owner to reclaim their locked UTxO.
 * The order book validator allows cancel when the tx is signed by ownerPkh.
 */
export async function cancelOrder(
  lucid: LucidEvolution,
  orderUtxo: UTxO,
  orderBookValidator: { type: string; script: string },
): Promise<string> {
  const redeemer = encodeOrderRedeemer('Cancel');
  const walletAddress = await lucid.wallet().address();
  const signed = await lucid
    .newTx()
    .collectFrom([orderUtxo], redeemer)
    .attach.SpendingValidator(orderBookValidator as any)
    .addSigner(walletAddress)
    .complete()
    .then(t => t.sign.withWallet().complete());
  return signed.submit();
}
