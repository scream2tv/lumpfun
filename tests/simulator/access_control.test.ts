import { describe, it, expect } from 'vitest';
import { deployInSimulator, getLedger } from './harness.js';
import { curveCostBuy } from '../../src/curve.js';

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

describe('LumpLaunch access control & parameter rejection', () => {
  // ── Constructor boundary & rejection ─────────────────────────────────

  it('constructor rejects fee_bps > 2000', async () => {
    await expect(deployInSimulator({ feeBps: 2001 })).rejects.toThrow(
      /fee_bps/i,
    );
  });

  it('constructor rejects share sum != 10000 (under)', async () => {
    await expect(
      deployInSimulator({ pBps: 5000, cBps: 4000, rBps: 500 }),
    ).rejects.toThrow(/share sum/i);
  });

  it('constructor rejects share sum != 10000 (over)', async () => {
    await expect(
      deployInSimulator({ pBps: 6000, cBps: 4000, rBps: 500 }),
    ).rejects.toThrow(/share sum/i);
  });

  it('constructor accepts boundary: fee_bps = 2000', async () => {
    const h = await deployInSimulator({ feeBps: 2000 });
    expect(getLedger(h).fee_bps).toBe(2000n);
  });

  it('constructor accepts boundary: fee_bps = 0', async () => {
    const h = await deployInSimulator({ feeBps: 0 });
    expect(getLedger(h).fee_bps).toBe(0n);
  });

  it('constructor accepts boundary: shares 100%/0/0', async () => {
    const h = await deployInSimulator({ pBps: 10000, cBps: 0, rBps: 0 });
    const s = getLedger(h);
    expect(s.platform_share_bps).toBe(10000n);
    expect(s.creator_share_bps).toBe(0n);
    expect(s.referral_share_bps).toBe(0n);
  });

  // ── Buy: per-field falsification rejection (caller-computes-verifies) ──

  it('buy with mismatched curveCost claim is rejected', async () => {
    const basePrice = 1000n;
    const slope = 1n;
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
    const buyer = new Uint8Array(32).fill(9);
    const n = 10n;
    const correctCost = curveCostBuy(0n, n, basePrice, slope);
    const wrongCost = correctCost + 1n; // off by one — integrity check must catch
    const cuts = rawCuts(wrongCost, feeBps, pBps, cBps, rBps);
    expect(() =>
      h.buy({
        buyer,
        nTokens: n,
        curveCost: wrongCost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/curve_cost/);
  });

  it('buy with mismatched fee claim (too high) is rejected', async () => {
    const h = await deployInSimulator({
      basePrice: 1000n,
      slope: 1n,
      maxSupply: 10_000n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const buyer = new Uint8Array(32).fill(9);
    const n = 10n;
    const cost = curveCostBuy(0n, n, 1000n, 1n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    // Bump fee_total up by 1 — the floor-equality check (10000·fee > curve*fb)
    // must fail.
    expect(() =>
      h.buy({
        buyer,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee + 1n,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/fee_total/);
  });

  it('buy with mismatched fee claim (too low) is rejected', async () => {
    const h = await deployInSimulator({
      basePrice: 1000n,
      slope: 1n,
      maxSupply: 10_000n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const buyer = new Uint8Array(32).fill(9);
    const n = 10n;
    const cost = curveCostBuy(0n, n, 1000n, 1n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    // Claim a fee that's strictly below the floor — only valid if fee is 0,
    // so ensure cuts.fee > 0 first. With cost ≈ 10_045 @ 100bps, fee=100 and
    // fee-1=99 should still fail the upper bound of the floor interval.
    expect(cuts.fee).toBeGreaterThan(0n);
    expect(() =>
      h.buy({
        buyer,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee - 1n,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/fee_total/);
  });

  it('buy with mismatched p_cut is rejected', async () => {
    const h = await deployInSimulator({
      basePrice: 1000n,
      slope: 1n,
      maxSupply: 10_000n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const buyer = new Uint8Array(32).fill(9);
    const n = 10n;
    const cost = curveCostBuy(0n, n, 1000n, 1n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    expect(() =>
      h.buy({
        buyer,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p + 1n, // off by one
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/p_cut|remainder/);
  });

  it('buy with mismatched c_cut is rejected', async () => {
    const h = await deployInSimulator({
      basePrice: 1000n,
      slope: 1n,
      maxSupply: 10_000n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const buyer = new Uint8Array(32).fill(9);
    const n = 10n;
    const cost = curveCostBuy(0n, n, 1000n, 1n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    expect(() =>
      h.buy({
        buyer,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c + 1n,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/c_cut|remainder/);
  });

  it('buy with mismatched r_cut is rejected', async () => {
    const h = await deployInSimulator({
      basePrice: 1000n,
      slope: 1n,
      maxSupply: 10_000n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const buyer = new Uint8Array(32).fill(9);
    const n = 10n;
    const cost = curveCostBuy(0n, n, 1000n, 1n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    expect(() =>
      h.buy({
        buyer,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r + 1n,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/r_cut|remainder/);
  });

  it('buy with mismatched remainder is rejected', async () => {
    const h = await deployInSimulator({
      basePrice: 1000n,
      slope: 1n,
      maxSupply: 10_000n,
      feeBps: 100,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const buyer = new Uint8Array(32).fill(9);
    const n = 10n;
    const cost = curveCostBuy(0n, n, 1000n, 1n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    // Correct cuts but break the remainder identity.
    expect(() =>
      h.buy({
        buyer,
        nTokens: n,
        curveCost: cost,
        feeTotal: cuts.fee,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder + 1n,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/remainder/);
  });

  // ── Sell: symmetry — mirror the buy falsification tests for sell ──────

  it('sell with mismatched curvePayout claim is rejected', async () => {
    const basePrice = 1000n;
    const slope = 1n;
    const h = await deployInSimulator({
      basePrice,
      slope,
      maxSupply: 10_000n,
      feeBps: 0,
      pBps: 5000,
      cBps: 4000,
      rBps: 1000,
    });
    const trader = new Uint8Array(32).fill(9);

    // Set up a position so sell is otherwise valid.
    const cost = curveCostBuy(0n, 50n, basePrice, slope);
    h.buy({
      buyer: trader,
      nTokens: 50n,
      curveCost: cost,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral: EMPTY_REF,
    });

    expect(() =>
      h.sell({
        seller: trader,
        nTokens: 10n,
        curvePayout: 42n, // wrong
        feeTotal: 0n,
        pCut: 0n,
        cCut: 0n,
        rCut: 0n,
        remainder: 0n,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/curve_payout/);
  });

  it('sell with mismatched fee claim is rejected', async () => {
    const basePrice = 1000n;
    const slope = 1n;
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
    const trader = new Uint8Array(32).fill(9);

    const buyCost = curveCostBuy(0n, 50n, basePrice, slope);
    const buyCuts = rawCuts(buyCost, feeBps, pBps, cBps, rBps);
    h.buy({
      buyer: trader,
      nTokens: 50n,
      curveCost: buyCost,
      feeTotal: buyCuts.fee,
      pCut: buyCuts.p,
      cCut: buyCuts.c,
      rCut: buyCuts.r,
      remainder: buyCuts.remainder,
      hasReferral: false,
      referral: EMPTY_REF,
    });

    // Wrong fee on a sell.
    const { curvePayoutSell } = await import('../../src/curve.js');
    const payout = curvePayoutSell(50n, 10n, basePrice, slope);
    const cuts = rawCuts(payout, feeBps, pBps, cBps, rBps);
    expect(() =>
      h.sell({
        seller: trader,
        nTokens: 10n,
        curvePayout: payout,
        feeTotal: cuts.fee + 1n,
        pCut: cuts.p,
        cCut: cuts.c,
        rCut: cuts.r,
        remainder: cuts.remainder,
        hasReferral: false,
        referral: EMPTY_REF,
      }),
    ).toThrow(/fee_total/);
  });

  // ── Withdrawals: open-call semantics ─────────────────────────────────

  it('withdraw_creator with zero accrual rejected', async () => {
    const h = await deployInSimulator();
    expect(() => h.withdrawCreator()).toThrow(/nothing to withdraw/);
  });

  it('withdraw_referral with no accrual for ref rejected', async () => {
    const h = await deployInSimulator();
    const nobody = new Uint8Array(32).fill(99);
    expect(() => h.withdrawReferral({ ref: nobody })).toThrow(
      /no accrual for ref/,
    );
  });

  // ── Transfer: edge rejections not in fees.test.ts ────────────────────

  it('transfer with zero amount rejected', async () => {
    const h = await deployInSimulator();
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    expect(() => h.transfer({ fromAddr: a, toAddr: b, amount: 0n })).toThrow(
      /zero amount/,
    );
  });

  it('transfer from address with no balance rejected', async () => {
    const h = await deployInSimulator();
    const nobody = new Uint8Array(32).fill(77);
    const recipient = new Uint8Array(32).fill(78);
    expect(() =>
      h.transfer({ fromAddr: nobody, toAddr: recipient, amount: 1n }),
    ).toThrow(/sender has no balance/);
  });
});
