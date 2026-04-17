import { describe, it, expect } from 'vitest';
import { deployInSimulator } from './harness.js';
import {
  curveCostBuy,
  curvePayoutSell,
  currentPrice,
} from '../../src/curve.js';
import { computeFeeSplit } from '../../src/fees.js';

const EMPTY_REF = new Uint8Array(32);

function rawCuts(
  curveSide: bigint,
  feeBps: number,
  pBps: number,
  cBps: number,
  rBps: number,
) {
  const fee = (curveSide * BigInt(feeBps)) / 10000n;
  const p = (fee * BigInt(pBps)) / 10000n;
  const c = (fee * BigInt(cBps)) / 10000n;
  const r = (fee * BigInt(rBps)) / 10000n;
  const remainder = fee - p - c - r;
  return { fee, p, c, r, remainder };
}

// Apply the same routing the contract applies (see buy/sell Step 9 in the
// .compact): platform absorbs remainder, and the referral cut routes to
// platform when no referral is present.
function routedFromRawCuts(
  cuts: { p: bigint; c: bigint; r: bigint; remainder: bigint },
  referralPresent: boolean,
): { platform: bigint; creator: bigint; referral: bigint } {
  if (referralPresent) {
    return {
      platform: cuts.p + cuts.remainder,
      creator: cuts.c,
      referral: cuts.r,
    };
  }
  return {
    platform: cuts.p + cuts.remainder + cuts.r,
    creator: cuts.c,
    referral: 0n,
  };
}

describe('TS parity', () => {
  it('curve_quote_buy (on-chain, doubled) / 2 == curveCostBuy for 100 random inputs', async () => {
    // Seeded PRNG so this test is reproducible despite "random".
    let seed = 0x1234ABCD;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xFFFFFFFF;
    };

    for (let i = 0; i < 100; i++) {
      const basePrice = BigInt(Math.floor(rand() * 1_000_000) + 1);
      const slope = BigInt(Math.floor(rand() * 1_000));
      const maxSupply = 10_000n;
      const h = await deployInSimulator({ basePrice, slope, maxSupply });
      const delta = BigInt(Math.floor(rand() * 100) + 1);

      const tsCost = curveCostBuy(0n, delta, basePrice, slope);
      // Chain circuit returns 2x the quote; caller divides by 2.
      const chainDoubled = h.curveQuoteBuy(delta);
      expect(chainDoubled % 2n).toBe(0n);
      expect(chainDoubled / 2n).toBe(tsCost);
    }
  });

  it('curve_quote_sell (after tokens_sold is established) matches curvePayoutSell', async () => {
    let seed = 0xFEED5EED;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xFFFFFFFF;
    };

    for (let i = 0; i < 30; i++) {
      const basePrice = BigInt(Math.floor(rand() * 100_000) + 1);
      const slope = BigInt(Math.floor(rand() * 100));
      const maxSupply = 10_000n;
      const h = await deployInSimulator({
        basePrice,
        slope,
        maxSupply,
        feeBps: 0,
        pBps: 5000,
        cBps: 4000,
        rBps: 1000,
      });
      const trader = new Uint8Array(32).fill(5);

      // Establish a starting supply so curve_quote_sell is defined.
      const seedN = BigInt(Math.floor(rand() * 500) + 50);
      const buyCost = curveCostBuy(0n, seedN, basePrice, slope);
      h.buy({
        buyer: trader,
        nTokens: seedN,
        curveCost: buyCost,
        feeTotal: 0n,
        pCut: 0n,
        cCut: 0n,
        rCut: 0n,
        remainder: 0n,
        hasReferral: false,
        referral: EMPTY_REF,
      });

      const delta = BigInt(Math.floor(rand() * Number(seedN)) + 1);
      const tsPayout = curvePayoutSell(seedN, delta, basePrice, slope);
      const chainDoubled = h.curveQuoteSell(delta);
      expect(chainDoubled % 2n).toBe(0n);
      expect(chainDoubled / 2n).toBe(tsPayout);
    }
  });

  it('current_price (on-chain) matches currentPrice(tokens_sold, base, slope) — starts at base', async () => {
    const basePrice = 12345n;
    const slope = 7n;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps: 0,
    });
    // Pre-trade: tokens_sold=0 → price == base.
    expect(h.currentPrice()).toBe(currentPrice(0n, basePrice, slope));
    expect(h.currentPrice()).toBe(basePrice);

    // After buying N, price == base + slope*N.
    const trader = new Uint8Array(32).fill(9);
    const n = 42n;
    const cost = curveCostBuy(0n, n, basePrice, slope);
    h.buy({
      buyer: trader,
      nTokens: n,
      curveCost: cost,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral: EMPTY_REF,
    });
    expect(h.currentPrice()).toBe(currentPrice(n, basePrice, slope));
  });

  it('balance_of (on-chain) matches ledger.balances for members and non-members', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps: 0,
    });

    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    const nobody = new Uint8Array(32).fill(99);

    // Non-member: both sides report 0.
    expect(h.balanceOf(a)).toBe(0n);
    expect(h.balanceOf(nobody)).toBe(0n);

    // After a buy, balance_of matches balances.lookup().
    const n = 25n;
    const cost = curveCostBuy(0n, n, basePrice, slope);
    h.buy({
      buyer: a,
      nTokens: n,
      curveCost: cost,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral: EMPTY_REF,
    });
    expect(h.balanceOf(a)).toBe(n);
    expect(h.balanceOf(b)).toBe(0n);

    // After a transfer from a to b.
    h.transfer({ fromAddr: a, toAddr: b, amount: 10n });
    expect(h.balanceOf(a)).toBe(15n);
    expect(h.balanceOf(b)).toBe(10n);
    expect(h.balanceOf(nobody)).toBe(0n);
  });

  it('computeFeeSplit agrees with the contract-accepted (raw + routed) cuts for 50 random inputs (no referral)', async () => {
    // For each random config, verify:
    //   1. The rawCuts we feed the circuit are accepted (no throw).
    //   2. computeFeeSplit's split equals the routed rawCuts — i.e., the
    //      TS mirror and the on-chain routing produce identical accruals.
    let seed = 0xBAADC0DE;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xFFFFFFFF;
    };

    for (let i = 0; i < 50; i++) {
      const feeBps = Math.floor(rand() * 2001); // 0..2000 inclusive
      const pBps = Math.floor(rand() * 10001);
      const cBps = Math.floor(rand() * (10001 - pBps));
      const rBps = 10000 - pBps - cBps;

      // Use a curve that keeps costs small-to-moderate (avoids u128 overflow).
      const basePrice = BigInt(Math.floor(rand() * 1_000_000) + 1);
      const slope = BigInt(Math.floor(rand() * 100));
      const n = BigInt(Math.floor(rand() * 50) + 1);

      const h = await deployInSimulator({
        basePrice,
        slope,
        maxSupply: 10_000n,
        feeBps,
        pBps,
        cBps,
        rBps,
      });
      const buyer = new Uint8Array(32).fill(9);

      const cost = curveCostBuy(0n, n, basePrice, slope);
      const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);

      // (1) Does the contract accept the rawCuts we computed? (If not, parity
      // between TS and chain is already broken — this is the relevant guard.)
      h.buy({
        buyer,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      });

      // (2) TS mirror: computeFeeSplit should produce the same routed split.
      const tsSplit = computeFeeSplit({
        curveSide: cost,
        feeBps,
        platformShareBps: pBps,
        creatorShareBps: cBps,
        referralShareBps: rBps,
        referralPresent: false,
      });
      const routed = routedFromRawCuts(cuts, false);
      expect(tsSplit.fee).toBe(cuts.fee);
      expect(tsSplit.split.platform).toBe(routed.platform);
      expect(tsSplit.split.creator).toBe(routed.creator);
      expect(tsSplit.split.referral).toBe(routed.referral);
    }
  });

  it('computeFeeSplit agrees with raw + routed cuts (referral present) for 30 random inputs', async () => {
    let seed = 0xBEEFC0DE;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xFFFFFFFF;
    };

    for (let i = 0; i < 30; i++) {
      const feeBps = Math.floor(rand() * 2001);
      const pBps = Math.floor(rand() * 10001);
      const cBps = Math.floor(rand() * (10001 - pBps));
      const rBps = 10000 - pBps - cBps;

      const basePrice = BigInt(Math.floor(rand() * 500_000) + 1);
      const slope = BigInt(Math.floor(rand() * 50));
      const n = BigInt(Math.floor(rand() * 30) + 1);

      const h = await deployInSimulator({
        basePrice,
        slope,
        maxSupply: 10_000n,
        feeBps,
        pBps,
        cBps,
        rBps,
      });
      const buyer = new Uint8Array(32).fill(9);
      const referral = new Uint8Array(32).fill(11);

      const cost = curveCostBuy(0n, n, basePrice, slope);
      const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);

      h.buy({
        buyer,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: true,
        referral,
      });

      const tsSplit = computeFeeSplit({
        curveSide: cost,
        feeBps,
        platformShareBps: pBps,
        creatorShareBps: cBps,
        referralShareBps: rBps,
        referralPresent: true,
      });
      const routed = routedFromRawCuts(cuts, true);
      expect(tsSplit.fee).toBe(cuts.fee);
      expect(tsSplit.split.platform).toBe(routed.platform);
      expect(tsSplit.split.creator).toBe(routed.creator);
      expect(tsSplit.split.referral).toBe(routed.referral);
    }
  });
});
