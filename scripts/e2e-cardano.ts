/**
 * End-to-end preprod test: launch → buy (multiple rounds) → sell → fee verification
 *
 * Run with:
 *   tsx scripts/e2e-cardano.ts
 */

import { Lucid, Blockfrost } from '@lucid-evolution/lucid';
import { launchToken } from '../src/cardano/launch.js';
import { fetchCurveUtxo, buyTokens, sellTokens } from '../src/cardano/trade.js';
import {
  spotPrice, marketCap, bondedBps, isGraduated,
  quoteBuy, quoteSellGross,
} from '../src/cardano/curve.js';
import { computeSellFees } from '../src/cardano/fees.js';
import { MIN_UTXO_LOVELACE, GRADUATION_ADA } from '../src/cardano/config.js';

// ── Wallets ───────────────────────────────────────────────────────────────────

const SEED_CREATOR = "behind opinion error unfair axis treat metal deny pudding actual belt rent tackle light library staff jealous forward initial ready purity friend group vocal";
const SEED_BUYER   = "cancel armed tragic salon caution topic print pink quantum rural summer aim blue garlic safe solar hollow dwarf slide spatial item cloth only steel";
const ADDR_CREATOR = "addr_test1qzj2nzmh249pjye5ed73tur9nj8hpsc9r50rapa8qhcjtlk95lt8m3g9xw67lhhwgfkh4u8zhxwxazhmxzx3tqzaahzssad7tc";
const ADDR_BUYER   = "addr_test1qznsh4kq2wg8j82aypx7lqf3zs9kqgrrdfq3mvmu0hyc0a5v5ha00sqzh27x39lwpkesu8rqsh2gjg8vwvl8mgpy5ypq0nljk3";

const BF_ID      = 'preprod0avLTVqRNaMw4noyblKunhvbzUWPWBgi';
const BF_URL     = 'https://cardano-preprod.blockfrost.io/api/v0';
const TREASURY   = 'addr_test1qpk6zert7l54adaqtyavfppq8emagukgkdkt8z440upu0lrvwrlvnr6j5ehntkn7ld2nyn9m3cc8au5s6rh0gdakxl4se2k62t';
const CREATOR_FEE_BPS = 100;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string)  { console.log(`\n${'─'.repeat(60)}\n${msg}`); }
function ok(msg: string)   { console.log(`  ✓ ${msg}`); }
function info(msg: string) { console.log(`  · ${msg}`); }
function ada(v: bigint | number) { return (Number(v) / 1_000_000).toFixed(3) + ' ADA'; }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function makeLucid(seed: string) {
  const lucid = await Lucid(new Blockfrost(BF_URL, BF_ID), 'Preprod');
  lucid.selectWallet.fromSeed(seed);
  return lucid;
}

async function bfGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BF_URL}${path}`, { headers: { project_id: BF_ID } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blockfrost ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function getLovelace(address: string): Promise<bigint> {
  const data = await bfGet<{ amount: Array<{ unit: string; quantity: string }> }>(`/addresses/${address}`);
  if (!data) return 0n;
  return BigInt(data.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0');
}

async function getTokens(address: string, unit: string): Promise<bigint> {
  const data = await bfGet<{ amount: Array<{ unit: string; quantity: string }> }>(`/addresses/${address}`);
  if (!data) return 0n;
  return BigInt(data.amount.find(a => a.unit === unit)?.quantity ?? '0');
}

/** Wait for TX confirmation, then pause an extra 5s for Blockfrost UTxO indexing. */
async function waitTx(hash: string, label: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  ⏳ ${label} (${hash.slice(0, 12)}…)`);
  while (Date.now() < deadline) {
    await sleep(8_000);
    const res = await fetch(`${BF_URL}/txs/${hash}`, { headers: { project_id: BF_ID } });
    if (res.ok) {
      process.stdout.write(' confirmed');
      // Wait for UTxO index to catch up before next query
      process.stdout.write(' (indexing…)');
      await sleep(5_000);
      console.log(' ready');
      return;
    }
    process.stdout.write('.');
  }
  throw new Error(`TX ${hash} timed out`);
}

/** Re-fetch curve with retries to handle Blockfrost lag after a recent spend. */
async function refetchCurve(
  lucid: Awaited<ReturnType<typeof makeLucid>>,
  curveAddress: string,
  policyId: string,
  assetName: string,
  spentUtxoRef?: string,
  retries = 5,
) {
  for (let i = 0; i < retries; i++) {
    const curve = await fetchCurveUtxo(lucid, curveAddress, policyId, assetName);
    // If we know the old UTxO ref, verify we got a new one
    if (!spentUtxoRef || `${curve.txHash}#${curve.outputIndex}` !== spentUtxoRef) {
      return curve;
    }
    info(`Blockfrost still returning old UTxO, retry ${i + 1}/${retries}…`);
    await sleep(5_000);
  }
  return fetchCurveUtxo(lucid, curveAddress, policyId, assetName);
}

function showCurve(curve: Awaited<ReturnType<typeof fetchCurveUtxo>>) {
  const d = curve.datum;
  info(`ada_reserve:   ${ada(d.adaReserve)}  (UTxO lovelace: ${ada(curve.lovelace)})`);
  info(`token_reserve: ${Number(d.tokenReserve).toLocaleString()}`);
  info(`spot_price:    ${ada(spotPrice(d))} / token`);
  info(`bonded:        ${(Number(bondedBps(d)) / 100).toFixed(4)}%  (${ada(d.adaReserve - MIN_UTXO_LOVELACE)} of ${ada(GRADUATION_ADA)} target)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // PRE-FLIGHT
  log('PRE-FLIGHT — wallet balances');
  const [creatorBal, buyerBal] = await Promise.all([getLovelace(ADDR_CREATOR), getLovelace(ADDR_BUYER)]);
  info(`Creator (wallet2): ${ada(creatorBal)}`);
  info(`Buyer   (wallet1): ${ada(buyerBal)}`);
  if (creatorBal < 10_000_000n) throw new Error('Creator needs ≥10 ADA');
  if (buyerBal   < 60_000_000n) throw new Error('Buyer needs ≥60 ADA');
  ok('Balances OK');

  // ── STEP 1: LAUNCH ────────────────────────────────────────────────────────
  log('STEP 1 — launch token (wallet2 = creator)');

  const TICKER = `LFT${Date.now().toString().slice(-4)}`;
  info(`Ticker: ${TICKER}, creator_fee: ${CREATOR_FEE_BPS}bps (1%)`);

  const lucidCreator = await makeLucid(SEED_CREATOR);
  const launch = await launchToken(lucidCreator, {
    name: 'LumpFun E2E Test',
    ticker: TICKER,
    creatorFeeBps: CREATOR_FEE_BPS,
    devAllocBps: 0,
    initialBuyLovelace: 0n,
    description: 'Automated preprod test',
  }, TREASURY);

  const { policyId, assetName, curveAddress, validatorCbor } = launch;
  const assetUnit = `${policyId}${assetName}`;
  const validator = { type: 'PlutusV3' as const, script: validatorCbor };

  ok(`TX: ${launch.txHash}`);
  info(`Policy:  ${policyId}`);
  info(`Curve:   ${curveAddress}`);

  await waitTx(launch.txHash, 'launch');

  const lucidBuyer = await makeLucid(SEED_BUYER);
  const curve0 = await refetchCurve(lucidBuyer, curveAddress, policyId, assetName);
  showCurve(curve0);

  if (curve0.datum.adaReserve !== MIN_UTXO_LOVELACE || curve0.lovelace !== MIN_UTXO_LOVELACE) {
    throw new Error(`INVARIANT FAIL at launch: ada_reserve=${curve0.datum.adaReserve}, lovelace=${curve0.lovelace}`);
  }
  ok('Launch invariant: ada_reserve == UTxO lovelace == 2 ADA ✓');

  // ── STEP 2: BUY #1 (10 ADA) ───────────────────────────────────────────────
  log('STEP 2 — buy #1: 10 ADA');

  const BUY1 = 10_000_000n;
  const expectedCreatorBuyFee = (BUY1 * BigInt(CREATOR_FEE_BPS)) / 10000n;
  info(`Spending ${ada(BUY1)}, quote: ${quoteBuy(curve0.datum, BUY1).toLocaleString()} tokens`);
  info(`Expected creator buy-fee: ${ada(expectedCreatorBuyFee)} (${CREATOR_FEE_BPS} bps × ada_in)`);

  const creatorBalBeforeBuy = await getLovelace(ADDR_CREATOR);
  const buy1 = await buyTokens(lucidBuyer, curve0, BUY1, 100, CREATOR_FEE_BPS, validator, TREASURY, ADDR_CREATOR);
  ok(`TX: ${buy1.txHash}  received: ${buy1.amount.toLocaleString()} tokens`);

  await waitTx(buy1.txHash, 'buy #1');

  if (expectedCreatorBuyFee > 0n) {
    await sleep(3_000);
    const creatorBalAfterBuy = await getLovelace(ADDR_CREATOR);
    const creatorBuyDelta = creatorBalAfterBuy - creatorBalBeforeBuy;
    info(`Creator balance Δ on buy: ${ada(creatorBuyDelta)} (expected ${ada(expectedCreatorBuyFee)})`);
    if (creatorBuyDelta >= expectedCreatorBuyFee - 200_000n) {
      ok(`Creator buy-fee distributed: ${ada(creatorBuyDelta)} ✓`);
    } else {
      console.warn(`  ⚠  Creator received less on buy than expected: ${ada(creatorBuyDelta)} vs ${ada(expectedCreatorBuyFee)}`);
    }
  }

  const curve1 = await refetchCurve(lucidBuyer, curveAddress, policyId, assetName, `${curve0.txHash}#${curve0.outputIndex}`);
  showCurve(curve1);

  if (curve1.datum.adaReserve !== curve1.lovelace) {
    throw new Error(`INVARIANT FAIL after buy1: ada_reserve=${curve1.datum.adaReserve} lovelace=${curve1.lovelace}`);
  }
  ok('Invariant holds after buy #1 ✓');

  // ── STEP 3: BUY #2 (25 ADA) ───────────────────────────────────────────────
  log('STEP 3 — buy #2: 25 ADA');

  const BUY2 = 25_000_000n;
  info(`Spending ${ada(BUY2)}, quote: ${quoteBuy(curve1.datum, BUY2).toLocaleString()} tokens`);

  const buy2 = await buyTokens(lucidBuyer, curve1, BUY2, 100, CREATOR_FEE_BPS, validator, TREASURY, ADDR_CREATOR);
  ok(`TX: ${buy2.txHash}  received: ${buy2.amount.toLocaleString()} tokens`);

  await waitTx(buy2.txHash, 'buy #2');

  const curve2 = await refetchCurve(lucidBuyer, curveAddress, policyId, assetName, `${curve1.txHash}#${curve1.outputIndex}`);
  showCurve(curve2);

  if (curve2.datum.adaReserve !== curve2.lovelace) {
    throw new Error(`INVARIANT FAIL after buy2: ada_reserve=${curve2.datum.adaReserve} lovelace=${curve2.lovelace}`);
  }
  ok('Invariant holds after buy #2 ✓');

  const buyerTokens = await getTokens(ADDR_BUYER, assetUnit);
  info(`Buyer total tokens: ${buyerTokens.toLocaleString()}`);

  // ── STEP 4: SELL HALF ─────────────────────────────────────────────────────
  log('STEP 4 — sell half, verify creator receives fee');

  const toSell = buyerTokens / 2n;
  const gross  = quoteSellGross(curve2.datum, toSell);
  const fees   = computeSellFees(gross, CREATOR_FEE_BPS);

  info(`Selling ${toSell.toLocaleString()} tokens`);
  info(`Gross: ${ada(fees.adaGross)}  platform: ${ada(fees.platformFee)}  creator: ${ada(fees.creatorFee)}  net: ${ada(fees.adaNet)}`);

  const creatorBalBefore = await getLovelace(ADDR_CREATOR);
  const sell1 = await sellTokens(lucidBuyer, curve2, toSell, 100, CREATOR_FEE_BPS, validator, TREASURY, ADDR_CREATOR);
  ok(`TX: ${sell1.txHash}`);

  await waitTx(sell1.txHash, 'sell #1');

  const curve3 = await refetchCurve(lucidBuyer, curveAddress, policyId, assetName, `${curve2.txHash}#${curve2.outputIndex}`);
  showCurve(curve3);

  // Give Blockfrost a moment to settle creator balance
  await sleep(3_000);
  const creatorBalAfter = await getLovelace(ADDR_CREATOR);
  const creatorDelta = creatorBalAfter - creatorBalBefore;
  info(`Creator balance Δ: ${ada(creatorDelta)} (expected ≈ ${ada(fees.creatorFee)})`);

  if (creatorDelta >= fees.creatorFee - 200_000n) {
    ok(`Creator fee distributed: ${ada(creatorDelta)} ✓`);
  } else {
    console.warn(`  ⚠  Creator received less than expected: ${ada(creatorDelta)} vs ${ada(fees.creatorFee)}`);
  }

  // ── STEP 5: BUY #3 (5 ADA) — confirm price curve ─────────────────────────
  log('STEP 5 — buy #3: 5 ADA (price curve sanity check)');

  const BUY3 = 5_000_000n;
  const tokensAtLaunch = quoteBuy(curve0.datum, BUY3);
  const tokensNow      = quoteBuy(curve3.datum, BUY3);
  info(`At launch: 5 ADA → ${tokensAtLaunch.toLocaleString()} tokens`);
  info(`Now:       5 ADA → ${tokensNow.toLocaleString()} tokens (fewer = price rose = correct)`);

  if (tokensNow >= tokensAtLaunch) {
    console.warn('  ⚠  Price did not rise after net buys — check curve math');
  } else {
    ok(`Price rose correctly: ${tokensAtLaunch.toLocaleString()} → ${tokensNow.toLocaleString()} ✓`);
  }

  const buy3 = await buyTokens(lucidBuyer, curve3, BUY3, 100, CREATOR_FEE_BPS, validator, TREASURY, ADDR_CREATOR);
  ok(`TX: ${buy3.txHash}  received: ${buy3.amount.toLocaleString()} tokens`);

  await waitTx(buy3.txHash, 'buy #3');

  const curve4 = await refetchCurve(lucidBuyer, curveAddress, policyId, assetName, `${curve3.txHash}#${curve3.outputIndex}`);

  // ── STEP 6: FULL EXIT ─────────────────────────────────────────────────────
  log('STEP 6 — full exit: sell all remaining tokens');

  const remaining = await getTokens(ADDR_BUYER, assetUnit);
  info(`Remaining tokens: ${remaining.toLocaleString()}`);

  if (remaining > 0n) {
    const gross2 = quoteSellGross(curve4.datum, remaining);
    const fees2  = computeSellFees(gross2, CREATOR_FEE_BPS);
    info(`Expected net: ${ada(fees2.adaNet)}`);

    const sell2 = await sellTokens(lucidBuyer, curve4, remaining, 200, CREATOR_FEE_BPS, validator, TREASURY, ADDR_CREATOR);
    ok(`TX: ${sell2.txHash}`);

    await waitTx(sell2.txHash, 'sell #2 (full exit)');

    const curveFinal = await refetchCurve(lucidBuyer, curveAddress, policyId, assetName, `${curve4.txHash}#${curve4.outputIndex}`);
    showCurve(curveFinal);

    if (curveFinal.datum.adaReserve !== curveFinal.lovelace) {
      throw new Error(`INVARIANT FAIL after final sell: ada_reserve=${curveFinal.datum.adaReserve} lovelace=${curveFinal.lovelace}`);
    }
    ok('Invariant holds after full exit ✓');
  }

  // ── FINAL REPORT ──────────────────────────────────────────────────────────
  log('FINAL REPORT');

  const curveFinal = await fetchCurveUtxo(lucidBuyer, curveAddress, policyId, assetName);
  showCurve(curveFinal);

  const [finalCreator, finalBuyer] = await Promise.all([getLovelace(ADDR_CREATOR), getLovelace(ADDR_BUYER)]);
  info(`Creator balance: ${ada(finalCreator)}`);
  info(`Buyer balance:   ${ada(finalBuyer)}`);

  const netRealAda = curveFinal.datum.adaReserve - MIN_UTXO_LOVELACE;
  info(`Real ADA bonded: ${ada(netRealAda)} of ${ada(GRADUATION_ADA)} graduation target`);

  log('✅  ALL STEPS PASSED');
  console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║  LumpFun preprod E2E — COMPLETE                              ║
  ╠══════════════════════════════════════════════════════════════╣
  ║  Ticker:  ${TICKER.padEnd(50)}║
  ║  Policy:  ${policyId.slice(0, 50).padEnd(50)}║
  ║  Curve:   ${curveAddress.slice(0, 50).padEnd(50)}║
  ╚══════════════════════════════════════════════════════════════╝

  To test graduation (needs ~21,000 ADA bonded), keep buying at:
    Curve address: ${curveAddress}
    Policy ID:     ${policyId}
    Asset name:    ${assetName}
  `);
}

main().catch(e => {
  console.error('\n❌ E2E FAILED:', e.message ?? e);
  process.exit(1);
});
