import { describe, it, expect } from 'vitest';
import { deployInSimulator } from './harness.js';
import { curveCostBuy, curvePayoutSell } from '../../src/curve.js';

// Helper: compute the raw (unrouted) fee cuts the contract expects as inputs.
// computeFeeSplit() from src/fees.ts routes the remainder (and absent-referral
// r_base) into the platform cut; the circuit wants the raw floor cuts for each.
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

describe('LumpLaunch.buy', () => {
  it('first buy: state exactly matches TS predictions', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const feeBps = 100;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;

    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 1_000_000n,
      feeBps,
      pBps,
      cBps,
      rBps,
    });

    const buyer = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32); // unused
    const n = 10n;
    const curveCost = curveCostBuy(0n, n, basePrice, slope);
    const cuts = rawCuts(curveCost, feeBps, pBps, cBps, rBps);

    h.buy({
      buyer,
      nTokens: n,
      curveCost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: false,
      referral,
    });

    const state = h.getLedger();
    expect(state.tokens_sold).toBe(n);
    expect(state.night_reserve).toBe(curveCost);
    expect(state.balances.member(buyer)).toBe(true);
    expect(state.balances.lookup(buyer)).toBe(n);
    // Absent-referral: platform_accrued = p_cut + remainder + r_cut.
    expect(state.platform_accrued).toBe(cuts.p + cuts.remainder + cuts.r);
    expect(state.creator_accrued).toBe(cuts.c);
  });

  it('buy with referral: referrals_accrued[ref] == r_cut', async () => {
    const basePrice = 2000n;
    const slope = 3n;
    const feeBps = 200;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;

    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps,
      pBps,
      cBps,
      rBps,
    });

    const buyer = new Uint8Array(32).fill(7);
    const referral = new Uint8Array(32).fill(11);
    const n = 50n;
    const curveCost = curveCostBuy(0n, n, basePrice, slope);
    const cuts = rawCuts(curveCost, feeBps, pBps, cBps, rBps);

    h.buy({
      buyer,
      nTokens: n,
      curveCost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: true,
      referral,
    });

    const state = h.getLedger();
    expect(state.referrals_accrued.member(referral)).toBe(true);
    expect(state.referrals_accrued.lookup(referral)).toBe(cuts.r);
    // With referral present: platform_accrued = p_cut + remainder (no r_cut).
    expect(state.platform_accrued).toBe(cuts.p + cuts.remainder);
    expect(state.creator_accrued).toBe(cuts.c);
  });

  it('zero tokens rejected', async () => {
    const h = await deployInSimulator({
      basePrice: 1000n,
      slope: 1n,
      maxSupply: 1_000_000n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });

    const buyer = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32);

    expect(() =>
      h.buy({
        buyer,
        nTokens: 0n,
        curveCost: 0n,
        feeTotal: 0n,
        pCut: 0n,
        cCut: 0n,
        rCut: 0n,
        remainder: 0n,
        hasReferral: false,
        referral,
      }),
    ).toThrow(/zero tokens/);
  });

  it('buy exceeding max_supply rejected', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const maxSupply = 100n;
    const feeBps = 100;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;

    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply,
      feeBps,
      pBps,
      cBps,
      rBps,
    });

    const buyer = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32);
    const n = 101n; // exceeds max_supply of 100
    const curveCost = curveCostBuy(0n, n, basePrice, slope);
    const cuts = rawCuts(curveCost, feeBps, pBps, cBps, rBps);

    expect(() =>
      h.buy({
        buyer,
        nTokens: n,
        curveCost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral,
      }),
    ).toThrow(/exceeds supply/);
  });

  it('after 10 buys, night_reserve == sum of curveCostBuy', async () => {
    const basePrice = 500n;
    const slope = 2n;
    const feeBps = 100;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;

    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps,
      pBps,
      cBps,
      rBps,
    });

    const buyer = new Uint8Array(32).fill(5);
    const referral = new Uint8Array(32);

    let sold = 0n;
    let cumulativeCurveCost = 0n;
    const chunkSizes = [1n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n];
    for (const chunk of chunkSizes) {
      const cost = curveCostBuy(sold, chunk, basePrice, slope);
      const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);
      h.buy({
        buyer,
        nTokens: chunk,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral,
      });
      sold += chunk;
      cumulativeCurveCost += cost;
    }

    const state = h.getLedger();
    expect(state.tokens_sold).toBe(sold);
    expect(state.night_reserve).toBe(cumulativeCurveCost);
    expect(state.balances.lookup(buyer)).toBe(sold);
  });
});

describe('LumpLaunch.sell', () => {
  it('sell after buy (zero-fee config): state exactly round-trips to zero residual', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 1_000_000n,
      feeBps: 0,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const trader = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32);

    // Buy 100 tokens at fee_bps=0.
    const buyCost = curveCostBuy(0n, 100n, basePrice, slope);
    h.buy({
      buyer: trader,
      nTokens: 100n,
      curveCost: buyCost,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral,
    });

    // Sell 100 tokens — should reverse exactly.
    const payout = curvePayoutSell(100n, 100n, basePrice, slope);
    h.sell({
      seller: trader,
      nTokens: 100n,
      curvePayout: payout,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral,
    });

    const state = h.getLedger();
    expect(state.tokens_sold).toBe(0n);
    expect(state.night_reserve).toBe(0n);
    expect(state.balances.lookup(trader)).toBe(0n);
    expect(payout).toBe(buyCost); // round-trip identity
  });

  it('partial sell: reserve equals integral to new tokens_sold', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 1_000_000n,
      feeBps: 0,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const trader = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32);

    const buyCost = curveCostBuy(0n, 100n, basePrice, slope);
    h.buy({
      buyer: trader,
      nTokens: 100n,
      curveCost: buyCost,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral,
    });

    const payout = curvePayoutSell(100n, 40n, basePrice, slope);
    h.sell({
      seller: trader,
      nTokens: 40n,
      curvePayout: payout,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral,
    });

    const state = h.getLedger();
    expect(state.tokens_sold).toBe(60n);
    expect(state.night_reserve).toBe(curveCostBuy(0n, 60n, basePrice, slope));
    expect(state.balances.lookup(trader)).toBe(60n);
  });

  it('sell with fees: fee accrues on the curve-payout side exactly per TS mirror', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const feeBps = 100;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 1_000_000n,
      feeBps,
      pBps,
      cBps,
      rBps,
    });
    const trader = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32);

    // Buy 100 with fee.
    const buyCost = curveCostBuy(0n, 100n, basePrice, slope);
    const buyCuts = rawCuts(buyCost, feeBps, pBps, cBps, rBps);
    h.buy({
      buyer: trader,
      nTokens: 100n,
      curveCost: buyCost,
      feeTotal: buyCuts.fee,
      pCut: buyCuts.p,
      cCut: buyCuts.c,
      rCut: buyCuts.r,
      remainder: buyCuts.remainder,
      hasReferral: false,
      referral,
    });
    const platformAfterBuy = h.getLedger().platform_accrued;
    const creatorAfterBuy = h.getLedger().creator_accrued;

    // Now sell 100.
    const payout = curvePayoutSell(100n, 100n, basePrice, slope);
    const sellCuts = rawCuts(payout, feeBps, pBps, cBps, rBps);
    h.sell({
      seller: trader,
      nTokens: 100n,
      curvePayout: payout,
      feeTotal: sellCuts.fee,
      pCut: sellCuts.p,
      cCut: sellCuts.c,
      rCut: sellCuts.r,
      remainder: sellCuts.remainder,
      hasReferral: false,
      referral,
    });

    const state = h.getLedger();
    // Absent-referral: platform += p + remainder + r.
    expect(state.platform_accrued).toBe(
      platformAfterBuy + sellCuts.p + sellCuts.remainder + sellCuts.r,
    );
    expect(state.creator_accrued).toBe(creatorAfterBuy + sellCuts.c);
    expect(state.tokens_sold).toBe(0n);
    expect(state.night_reserve).toBe(0n);
    expect(state.balances.lookup(trader)).toBe(0n);
  });

  it('sell beyond balance rejected', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const feeBps = 100;
    const pBps = 5000;
    const cBps = 4000;
    const rBps = 1000;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 1_000_000n,
      feeBps,
      pBps,
      cBps,
      rBps,
    });
    const trader = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32);

    // Buy 10 tokens first.
    const cost = curveCostBuy(0n, 10n, basePrice, slope);
    const cuts = rawCuts(cost, feeBps, pBps, cBps, rBps);
    h.buy({
      buyer: trader,
      nTokens: 10n,
      curveCost: cost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: false,
      referral,
    });

    // Attempting to sell 11 (one more than owned) must be rejected by the
    // circuit. curvePayoutSell(10,11) would throw in TS, so supply zeros —
    // the circuit's "sell > tokens_sold" / "insufficient balance" assertions
    // fire before any curve-identity check.
    expect(() =>
      h.sell({
        seller: trader,
        nTokens: 11n,
        curvePayout: 0n,
        feeTotal: 0n,
        pCut: 0n,
        cCut: 0n,
        rCut: 0n,
        remainder: 0n,
        hasReferral: false,
        referral,
      }),
    ).toThrow();
  });

  it('sell of 0 rejected', async () => {
    const h = await deployInSimulator();
    const trader = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32);

    expect(() =>
      h.sell({
        seller: trader,
        nTokens: 0n,
        curvePayout: 0n,
        feeTotal: 0n,
        pCut: 0n,
        cCut: 0n,
        rCut: 0n,
        remainder: 0n,
        hasReferral: false,
        referral,
      }),
    ).toThrow(/zero tokens/);
  });
});
