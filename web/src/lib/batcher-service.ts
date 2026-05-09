// Server-only batcher. Drains pending orders from the shared order_book
// validator, one order per tx, sequentially against each curve UTxO.
//
// Trust model recap: orders are owner-cancellable at any time; the curve
// validator independently enforces all math + fee invariants. The batcher
// only provides liveness — it cannot seize funds. Signs with BATCHER_SEED
// when set, falling back to TREASURY_SEED for backwards-compat with single-
// seed deployments. The split matters for production: TREASURY_SEED also
// signs graduations (graduate-server.ts), which means the signing wallet
// ends up *holding* drained curve liquidity + Minswap LP tokens. Keeping
// graduation routed to the real treasury and queue settlement routed to a
// hot/replaceable batcher wallet limits blast radius if the batcher seed
// is ever compromised.
//
// Settlement remains sequential per curve UTxO (one trade per block); the
// gain over the direct-consume path is *concurrent user intent* + reliable
// drain instead of users racing to spend the curve UTxO themselves.

import 'server-only';
import {
  Lucid as LucidEv,
  Blockfrost as BlockfrostEv,
  Constr,
  type LucidEvolution,
  type UTxO as UTxOEv,
} from '@lucid-evolution/lucid';

import type { TokenMeta } from './types';
import { getAllTokens } from './registry';
import {
  ORDER_BOOK_VALIDATOR, getOrderBookAddress,
} from './order-book';
import {
  decodeOrderDatum, encodeOrderRedeemer, type OrderDatum,
} from './order-codec';
import { quoteBuy, quoteSellGross } from './curve-math';
import { Data } from '@lucid-evolution/lucid';

// ── Env ────────────────────────────────────────────────────────────────────

function env() {
  const network    = (process.env.CARDANO_NETWORK ?? process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') as 'Mainnet' | 'Preprod';
  const projectId  = process.env.BLOCKFROST_PROJECT_ID ?? '';
  // Prefer BATCHER_SEED when set (production: dedicated hot key for queue
  // settlement). Fall back to TREASURY_SEED for single-seed dev/preprod
  // setups where one wallet does everything.
  const seedPhrase = process.env.BATCHER_SEED ?? process.env.TREASURY_SEED ?? '';
  const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '';
  const baseUrl    = network === 'Mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0';
  if (!projectId)       throw new Error('BLOCKFROST_PROJECT_ID not set');
  if (!seedPhrase)      throw new Error('Neither BATCHER_SEED nor TREASURY_SEED set');
  if (!treasuryAddress) throw new Error('NEXT_PUBLIC_TREASURY_ADDRESS not set');
  return { network, projectId, seedPhrase, baseUrl, treasuryAddress };
}

// ── Plutus encoders (kept inline so we don't tempt a circular import on
//    the trade panel's own encoders).

const PLATFORM_FEE      = 1_000_000n;
const MIN_UTXO_LOVELACE = 2_000_000n;

function encodeCurveDatum(adaReserve: bigint, tokenReserve: bigint): string {
  return Data.to(new Constr(0, [adaReserve, tokenReserve]));
}

function decodeCurveDatum(raw: string): { adaReserve: bigint; tokenReserve: bigint } {
  const c = Data.from(raw) as Constr<bigint>;
  if (c.index !== 0 || c.fields.length !== 2) throw new Error('bad curve datum');
  return { adaReserve: c.fields[0], tokenReserve: c.fields[1] };
}

function encodeCurveRedeemer(tag: 'Buy' | 'Sell', minOut: bigint): string {
  return Data.to(new Constr(tag === 'Buy' ? 0 : 1, [minOut]));
}

// ── Active token resolution ────────────────────────────────────────────────
// Drain only tokens that haven't graduated. A token whose curve UTxO is
// already gone (graduated) has nothing to drain, and trying would just
// fail at the validator.

async function activeTokens(): Promise<TokenMeta[]> {
  const all = await getAllTokens();
  return all.filter(t => !t.minswapPoolTxHash && !t.graduatedTxHash);
}

// ── Order fetch + FIFO order ───────────────────────────────────────────────
// Lucid's utxosAt returns UTxOs in Blockfrost's natural order, which is
// production-order (oldest first). We additionally sort by (txHash,
// outputIndex) lex ascending as a deterministic tiebreak so two batcher
// invocations against the same set always pick the same "first" order.

async function fetchPendingOrders(
  lucid: LucidEvolution,
  orderBookAddress: string,
  policyId: string,
  assetName: string,
): Promise<Array<{ utxo: UTxOEv; order: OrderDatum }>> {
  const utxos = await lucid.utxosAt(orderBookAddress);
  const out: Array<{ utxo: UTxOEv; order: OrderDatum }> = [];
  for (const u of utxos) {
    if (!u.datum) continue;
    try {
      const order = decodeOrderDatum(u.datum);
      if (order.curvePolicyId === policyId && order.curveAssetName === assetName) {
        out.push({ utxo: u, order });
      }
    } catch { /* not an order datum we recognise */ }
  }
  // FIFO within a token. Stable sort means we honour the underlying
  // production order, with the txHash/outputIndex tiebreak.
  out.sort((a, b) => {
    if (a.utxo.txHash       < b.utxo.txHash)       return -1;
    if (a.utxo.txHash       > b.utxo.txHash)       return  1;
    return a.utxo.outputIndex - b.utxo.outputIndex;
  });
  return out;
}

async function fetchCurveUtxoForToken(
  lucid: LucidEvolution,
  meta: TokenMeta,
): Promise<{ utxo: UTxOEv; adaReserve: bigint; tokenReserve: bigint } | null> {
  const assetUnit = `${meta.policyId}${meta.assetName}`;
  const utxos = await lucid.utxosAt(meta.curveAddress);
  const u = utxos.find(x => x.assets[assetUnit] !== undefined);
  if (!u || !u.datum) return null;
  const d = decodeCurveDatum(u.datum);
  return { utxo: u, adaReserve: d.adaReserve, tokenReserve: d.tokenReserve };
}

// ── Per-token bonding-curve validator (parameterised) ──────────────────────
// meta.validatorCbor is already the parameterised, ready-to-attach CBOR
// (produced at launch time via applyDoubleCborEncoding+applyParamsToScript
// and stored in the registry). The direct path (cardano-tx.ts) attaches
// it as-is — we must do the same here, otherwise we double-wrap the
// envelope and Lucid sees a different script hash than the curve UTxO's
// address, producing "TranslationLogicMissingInput" + ValueNotConserved
// failures at submit time.

function curveValidator(meta: TokenMeta) {
  return {
    type:   'PlutusV3' as const,
    script: meta.validatorCbor,
  };
}

// ── Single order execution ─────────────────────────────────────────────────

async function executeOneOrder(
  lucid: LucidEvolution,
  meta: TokenMeta,
  curveUtxo: UTxOEv,
  curveAda: bigint,
  curveTokens: bigint,
  orderUtxo: UTxOEv,
  order: OrderDatum,
  treasuryAddress: string,
  network: 'Mainnet' | 'Preprod',
): Promise<{ txHash: string } | { skipped: 'slippage' }> {
  const assetUnit = `${meta.policyId}${meta.assetName}`;
  const orderRedeemer = encodeOrderRedeemer('Execute');

  const ownerAddr = await deriveOwnerAddress(network, order.ownerPkh, order.ownerStake);

  if (order.action === 'Buy') {
    const adaIn     = order.amount;
    const tokensOut = quoteBuy(curveAda, curveTokens, adaIn);
    if (tokensOut < order.minOut) return { skipped: 'slippage' };

    const creatorFee = (adaIn * BigInt(meta.creatorFeeBps)) / 10000n;

    const newAda    = curveAda + adaIn;
    const newTokens = curveTokens - tokensOut;
    const newDatum  = encodeCurveDatum(newAda, newTokens);

    const tx = lucid
      .newTx()
      .collectFrom([orderUtxo], orderRedeemer)
      .collectFrom([curveUtxo], encodeCurveRedeemer('Buy', order.minOut))
      .attach.SpendingValidator(ORDER_BOOK_VALIDATOR)
      .attach.SpendingValidator(curveValidator(meta))
      .pay.ToAddressWithData(
        meta.curveAddress,
        { kind: 'inline', value: newDatum },
        { lovelace: (curveUtxo.assets.lovelace ?? 0n) + adaIn, [assetUnit]: newTokens },
      )
      .pay.ToAddress(treasuryAddress, { lovelace: PLATFORM_FEE });
    if (creatorFee > 0n) {
      const creatorOut = meta.feeAccumulatorAddress ?? meta.creatorAddress;
      tx.pay.ToAddress(creatorOut, { lovelace: creatorFee });
    }
    tx.pay.ToAddress(ownerAddr, { lovelace: MIN_UTXO_LOVELACE, [assetUnit]: tokensOut });

    const completed = await tx.complete();
    const signed    = await completed.sign.withWallet().complete();
    const txHash    = await signed.submit();
    return { txHash };
  }

  // Sell
  const tokensIn  = order.amount;
  const grossAda  = quoteSellGross(curveAda, curveTokens, tokensIn);
  const creatorFee = (grossAda * BigInt(meta.creatorFeeBps)) / 10000n;
  const adaNet    = grossAda - PLATFORM_FEE - creatorFee;
  if (adaNet < order.minOut) return { skipped: 'slippage' };

  const newAda    = curveAda - grossAda;
  const newTokens = curveTokens + tokensIn;
  const newDatum  = encodeCurveDatum(newAda, newTokens);

  const tx = lucid
    .newTx()
    .collectFrom([orderUtxo], orderRedeemer)
    .collectFrom([curveUtxo], encodeCurveRedeemer('Sell', order.minOut))
    .attach.SpendingValidator(ORDER_BOOK_VALIDATOR)
    .attach.SpendingValidator(curveValidator(meta))
    .pay.ToAddressWithData(
      meta.curveAddress,
      { kind: 'inline', value: newDatum },
      { lovelace: (curveUtxo.assets.lovelace ?? 0n) - grossAda, [assetUnit]: newTokens },
    )
    .pay.ToAddress(treasuryAddress, { lovelace: PLATFORM_FEE });
  if (creatorFee > 0n) {
    const creatorOut = meta.feeAccumulatorAddress ?? meta.creatorAddress;
    tx.pay.ToAddress(creatorOut, { lovelace: creatorFee });
  }
  tx.pay.ToAddress(ownerAddr, { lovelace: adaNet });

  const completed = await tx.complete();
  const signed    = await completed.sign.withWallet().complete();
  const txHash    = await signed.submit();
  return { txHash };
}

// Lucid-Evolution exposes credentialToAddress via its top-level export.
// Importing it lazily here keeps the bundle clean and avoids name clashes.
//
// When the order datum carries a stake credential (new schema), build the
// full base address so trade outputs land at the user's main wallet
// address. Legacy orders (8-field datum, no stake) fall through to an
// enterprise address derived from the payment-key alone — same behaviour
// as before this migration. Either way the seller can spend the output
// because the payment key is the same.
async function deriveOwnerAddress(
  network: 'Mainnet' | 'Preprod',
  pkh: string,
  stakeHash?: string,
): Promise<string> {
  const { credentialToAddress } = await import('@lucid-evolution/lucid');
  if (stakeHash) {
    return credentialToAddress(
      network,
      { type: 'Key', hash: pkh },
      { type: 'Key', hash: stakeHash },
    );
  }
  return credentialToAddress(network, { type: 'Key', hash: pkh });
}

// ── Per-token drain ────────────────────────────────────────────────────────

async function drainToken(
  lucid: LucidEvolution,
  meta: TokenMeta,
  treasuryAddress: string,
  network: 'Mainnet' | 'Preprod',
  orderBookAddress: string,
): Promise<{ processed: number; skipped: number; errors: number }> {
  const orders = await fetchPendingOrders(lucid, orderBookAddress, meta.policyId, meta.assetName);
  let processed = 0, skipped = 0, errors = 0;

  for (const { utxo: orderUtxo, order } of orders) {
    // Refetch curve before every order — settlement is sequential, the
    // previous tx's continuation is the new input.
    const curve = await fetchCurveUtxoForToken(lucid, meta);
    if (!curve) {
      // Curve gone (graduated mid-drain). Stop processing this token.
      break;
    }

    try {
      const result = await executeOneOrder(
        lucid, meta, curve.utxo, curve.adaReserve, curve.tokenReserve,
        orderUtxo, order, treasuryAddress, network,
      );
      if ('skipped' in result) {
        skipped++;
        continue;
      }
      processed++;
      // Sequential per curve: wait for confirmation before consuming the
      // continuation in the next iteration.
      await lucid.awaitTx(result.txHash);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // CURVE_UTXO_GONE recovery: if the curve UTxO our build referenced
      // was already spent by another tx (a competing direct-trade or
      // sibling batcher), refetch + retry once.
      const looksLikeRace = /input.*already spent|BadInputs|input not found/i.test(msg);
      if (looksLikeRace) {
        try {
          const curve2 = await fetchCurveUtxoForToken(lucid, meta);
          if (!curve2) break;
          const result2 = await executeOneOrder(
            lucid, meta, curve2.utxo, curve2.adaReserve, curve2.tokenReserve,
            orderUtxo, order, treasuryAddress, network,
          );
          if ('skipped' in result2) {
            skipped++;
          } else {
            processed++;
            await lucid.awaitTx(result2.txHash);
          }
          continue;
        } catch (retryErr) {
          console.error(`[batcher] retry failed for ${meta.ticker} ${orderUtxo.txHash}#${orderUtxo.outputIndex}:`, retryErr);
          errors++;
          continue;
        }
      }
      console.error(`[batcher] order failed for ${meta.ticker} ${orderUtxo.txHash}#${orderUtxo.outputIndex}:`, msg);
      errors++;
    }
  }

  return { processed, skipped, errors };
}

// ── Public entry point ─────────────────────────────────────────────────────

export interface TickResult {
  tokensTried:     number;
  tokensWithOrders: number;
  ordersProcessed: number;
  ordersSkipped:   number;
  errors:          number;
  byToken:         Array<{ ticker: string; processed: number; skipped: number; errors: number }>;
}

// In-flight set: mirrors the graduation-pipeline pattern. Prevents two
// triggers (cron + on-submit) from racing on the same address.
let tickInFlight = false;

export async function runBatcherTick(): Promise<TickResult> {
  if (tickInFlight) {
    return { tokensTried: 0, tokensWithOrders: 0, ordersProcessed: 0, ordersSkipped: 0, errors: 0, byToken: [] };
  }
  tickInFlight = true;
  try {
    const { network, projectId, seedPhrase, baseUrl, treasuryAddress } = env();
    const lucid = await LucidEv(new BlockfrostEv(baseUrl, projectId), network);
    lucid.selectWallet.fromSeed(seedPhrase);
    const orderBookAddress = getOrderBookAddress(network);

    const tokens = await activeTokens();
    const result: TickResult = {
      tokensTried:      tokens.length,
      tokensWithOrders: 0,
      ordersProcessed:  0,
      ordersSkipped:    0,
      errors:           0,
      byToken:          [],
    };

    for (const meta of tokens) {
      try {
        const r = await drainToken(lucid, meta, treasuryAddress, network, orderBookAddress);
        if (r.processed + r.skipped + r.errors === 0) continue;
        result.tokensWithOrders += 1;
        result.ordersProcessed  += r.processed;
        result.ordersSkipped    += r.skipped;
        result.errors           += r.errors;
        result.byToken.push({ ticker: meta.ticker, ...r });
      } catch (err) {
        console.error(`[batcher] drainToken crashed for ${meta.ticker}:`, err);
        result.errors += 1;
      }
    }

    return result;
  } finally {
    tickInFlight = false;
  }
}
