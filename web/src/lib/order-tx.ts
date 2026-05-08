// User-side order tx builders. The web client calls these when
// NEXT_PUBLIC_USE_QUEUE=1 instead of the direct buyTokens / sellTokens
// path. Each call locks an OrderDatum UTxO at the shared order_book
// validator address; a server-side batcher (see batcher-service.ts)
// drains the queue against the curve UTxO sequentially.
//
// Trust model: the user keeps cancellation rights via the order_book
// validator's Cancel redeemer (signed by ownerPkh). The batcher cannot
// seize funds — the curve validator independently enforces all math /
// fee invariants. Only liveness depends on the operator.

import { getAddressDetails } from '@lucid-evolution/lucid';
import type { Cip30Api } from './wallet';
import { getLucid } from './cardano-tx';
import { quoteBuy, quoteSellGross } from './curve-math';
import {
  encodeOrderDatum, encodeOrderRedeemer, type OrderDatum,
} from './order-codec';
import { ORDER_BOOK_VALIDATOR, getOrderBookAddress } from './order-book';

// Order-side reflection of the trade-panel's economics. Kept identical to
// what the curve validator enforces so the batcher's Lucid evaluation
// matches what the user signed.
const PLATFORM_FEE      = 1_000_000n;        // 1 ADA, validator-checked
const MIN_UTXO_LOVELACE = 2_000_000n;        // safe min for a UTxO carrying tokens
const NETWORK = (process.env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet' ? 'Mainnet' : 'Preprod') as 'Mainnet' | 'Preprod';

// ── Helpers ────────────────────────────────────────────────────────────────

function pkhFromBech32(addr: string): string {
  const d = getAddressDetails(addr);
  if (!d.paymentCredential?.hash) throw new Error(`No payment credential for ${addr.slice(0, 12)}…`);
  return d.paymentCredential.hash;
}

// ── Buy order ──────────────────────────────────────────────────────────────

export interface BuyOrderParams {
  policyId:        string;
  assetName:       string;        // hex
  curveAddress:    string;        // bech32 (informational; recorded for batcher)
  creatorAddress:  string;        // bech32
  treasuryAddress: string;        // bech32
  creatorFeeBps:   number;
  adaIn:           bigint;        // lovelace user wants to spend on tokens
  slippageBps:     number;
  // Live curve state at the time of submission — used to compute minOut.
  // The batcher will re-quote against the actual on-chain state when it
  // executes, so this is just the slippage floor, not a guaranteed price.
  adaReserve:      bigint;
  tokenReserve:    bigint;
}

export interface SubmittedOrder {
  txHash:      string;
  outputIndex: number;
  // Predictively the OutputReference of the locked order UTxO. The first
  // output of the tx is always the order itself (we set it that way).
  orderRef:    { txHash: string; outputIndex: number };
}

export async function submitBuyOrder(
  walletApi: Cip30Api,
  p: BuyOrderParams,
): Promise<SubmittedOrder> {
  const lucid = await getLucid(walletApi);
  const walletAddr = await lucid.wallet().address();
  const ownerPkh = pkhFromBech32(walletAddr);

  // Slippage floor — minOut tokens must be receivable; the batcher will
  // skip the order if the live curve has drifted past this point.
  const expectedOut = quoteBuy(p.adaReserve, p.tokenReserve, p.adaIn);
  const minOut = expectedOut - (expectedOut * BigInt(p.slippageBps)) / 10000n;
  if (minOut < 1n) throw new Error('Order amount too small after slippage');

  const creatorFee = (p.adaIn * BigInt(p.creatorFeeBps)) / 10000n;

  // Total ADA the order must lock: trade ADA + protocol fee + creator
  // rev-share + the min UTxO that comes back to the user with tokens.
  // Tx fees are paid by the batcher's wallet at execution time.
  const lockedLovelace = p.adaIn + PLATFORM_FEE + creatorFee + MIN_UTXO_LOVELACE;

  const datum: OrderDatum = {
    ownerPkh,
    curvePolicyId:  p.policyId,
    curveAssetName: p.assetName,
    action:         'Buy',
    amount:         p.adaIn,
    minOut,
    creatorPkh:  pkhFromBech32(p.creatorAddress),
    treasuryPkh: pkhFromBech32(p.treasuryAddress),
  };

  const orderBook = getOrderBookAddress(NETWORK);

  const tx = await lucid.newTx()
    .pay.ToAddressWithData(
      orderBook,
      { kind: 'inline', value: encodeOrderDatum(datum) },
      { lovelace: lockedLovelace },
    )
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  // The order output is always index 0 because we add it before any change.
  return { txHash, outputIndex: 0, orderRef: { txHash, outputIndex: 0 } };
}

// ── Sell order ─────────────────────────────────────────────────────────────

export interface SellOrderParams {
  policyId:        string;
  assetName:       string;
  curveAddress:    string;
  creatorAddress:  string;
  treasuryAddress: string;
  creatorFeeBps:   number;
  tokensIn:        bigint;
  slippageBps:     number;
  adaReserve:      bigint;
  tokenReserve:    bigint;
}

export async function submitSellOrder(
  walletApi: Cip30Api,
  p: SellOrderParams,
): Promise<SubmittedOrder> {
  const lucid = await getLucid(walletApi);
  const walletAddr = await lucid.wallet().address();
  const ownerPkh = pkhFromBech32(walletAddr);

  const grossAda  = quoteSellGross(p.adaReserve, p.tokenReserve, p.tokensIn);
  const creatorFee = (grossAda * BigInt(p.creatorFeeBps)) / 10000n;
  const adaNet    = grossAda - PLATFORM_FEE - creatorFee;
  const minOut    = adaNet - (adaNet * BigInt(p.slippageBps)) / 10000n;
  if (adaNet < MIN_UTXO_LOVELACE) {
    throw new Error('Sell amount too small — net ADA after fees is below the Cardano minimum output (1 ADA)');
  }

  // The sell-order UTxO holds the seller's tokens and a small ADA buffer
  // so the UTxO meets the per-bundle min-ADA requirement. The curve's own
  // ADA reserve covers all fees + the seller's payout at execution time.
  const lockedLovelace = MIN_UTXO_LOVELACE;

  const datum: OrderDatum = {
    ownerPkh,
    curvePolicyId:  p.policyId,
    curveAssetName: p.assetName,
    action:         'Sell',
    amount:         p.tokensIn,
    minOut,
    creatorPkh:  pkhFromBech32(p.creatorAddress),
    treasuryPkh: pkhFromBech32(p.treasuryAddress),
  };

  const orderBook = getOrderBookAddress(NETWORK);
  const assetUnit = `${p.policyId}${p.assetName}`;

  const tx = await lucid.newTx()
    .pay.ToAddressWithData(
      orderBook,
      { kind: 'inline', value: encodeOrderDatum(datum) },
      { lovelace: lockedLovelace, [assetUnit]: p.tokensIn },
    )
    .complete();

  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();

  return { txHash, outputIndex: 0, orderRef: { txHash, outputIndex: 0 } };
}

// ── Cancel ─────────────────────────────────────────────────────────────────
// Owner-signed reclaim of a pending order. The order_book validator only
// permits Cancel when the tx is signed by the order's ownerPkh; the funds
// (ADA and any locked tokens) flow back to the owner's wallet as change.
//
// Caller passes just the OutputReference — we resolve the full UTxO
// (including its inline datum, which the validator reads) from chain via
// Lucid so the PendingOrders UI doesn't have to thread it through.

export async function cancelOrder(
  walletApi: Cip30Api,
  ref: { txHash: string; outputIndex: number },
): Promise<string> {
  const lucid = await getLucid(walletApi);
  const walletAddr = await lucid.wallet().address();

  const utxos = await lucid.utxosByOutRef([ref]);
  if (utxos.length === 0) throw new Error('Order UTxO not found — already cancelled or executed');
  const orderUtxo = utxos[0];

  const tx = await lucid.newTx()
    .collectFrom([orderUtxo], encodeOrderRedeemer('Cancel'))
    .attach.SpendingValidator(ORDER_BOOK_VALIDATOR)
    .addSigner(walletAddr)
    .complete();

  const signed = await tx.sign.withWallet().complete();
  return signed.submit();
}
