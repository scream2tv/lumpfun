import { describe, it, expect } from 'vitest';
import { deployInSimulator, getLedger } from './harness.js';
import { curveCostBuy } from '../../src/curve.js';

// Same raw-cut helper as curve.test.ts (kept here so fees.test.ts stands
// alone and doesn't depend on being ordered after curve.test.ts).
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

const EMPTY_REF = new Uint8Array(32);

describe('LumpLaunch fees & withdrawals', () => {
  it('rounding case: curveCost=999 fee_bps=100 → fee=9, p=4, c=3, r=0, remainder=2', async () => {
    const h = await deployInSimulator({
      basePrice: 999n,
      slope: 0n,
      maxSupply: 10n,
      feeBps: 100,
    });
    const buyer = new Uint8Array(32).fill(9);
    const cost = curveCostBuy(0n, 1n, 999n, 0n); // = 999
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    // Sanity: cuts.fee=9, cuts.p=4, cuts.c=3, cuts.r=0, cuts.remainder=2.
    expect(cuts.fee).toBe(9n);
    expect(cuts.p).toBe(4n);
    expect(cuts.c).toBe(3n);
    expect(cuts.r).toBe(0n);
    expect(cuts.remainder).toBe(2n);
    h.buy({
      buyer,
      nTokens: 1n,
      curveCost: cost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: false,
      referral: EMPTY_REF,
    });
    const s = getLedger(h);
    // absent referral: platform_accrued += p + remainder + r = 4 + 2 + 0 = 6
    expect(s.platform_accrued).toBe(6n);
    expect(s.creator_accrued).toBe(3n);
  });

  it('referral present: referrals_accrued[ref] receives r_cut exactly', async () => {
    const h = await deployInSimulator({
      basePrice: 10_000n,
      slope: 0n,
      maxSupply: 10n,
      feeBps: 100,
    });
    const buyer = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32).fill(7);
    const cost = curveCostBuy(0n, 1n, 10_000n, 0n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    h.buy({
      buyer,
      nTokens: 1n,
      curveCost: cost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: true,
      referral,
    });
    const s = getLedger(h);
    expect(s.referrals_accrued.lookup(referral)).toBe(cuts.r);
    // platform_accrued did NOT absorb r_cut: should be p + remainder only.
    expect(s.platform_accrued).toBe(cuts.p + cuts.remainder);
  });

  it('withdraw_platform zeros accrual', async () => {
    const h = await deployInSimulator({
      basePrice: 10_000n,
      slope: 0n,
      maxSupply: 10n,
      feeBps: 100,
    });
    const buyer = new Uint8Array(32).fill(9);
    const cost = curveCostBuy(0n, 1n, 10_000n, 0n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    h.buy({
      buyer,
      nTokens: 1n,
      curveCost: cost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: false,
      referral: EMPTY_REF,
    });
    expect(getLedger(h).platform_accrued).toBeGreaterThan(0n);
    h.withdrawPlatform();
    expect(getLedger(h).platform_accrued).toBe(0n);
  });

  it('withdraw_platform with zero accrual rejected', async () => {
    const h = await deployInSimulator();
    expect(() => h.withdrawPlatform()).toThrow();
  });

  it('withdraw_creator zeros accrual', async () => {
    const h = await deployInSimulator({
      basePrice: 10_000n,
      slope: 0n,
      maxSupply: 10n,
      feeBps: 100,
    });
    const buyer = new Uint8Array(32).fill(9);
    const cost = curveCostBuy(0n, 1n, 10_000n, 0n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    h.buy({
      buyer,
      nTokens: 1n,
      curveCost: cost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: false,
      referral: EMPTY_REF,
    });
    expect(getLedger(h).creator_accrued).toBe(cuts.c);
    h.withdrawCreator();
    expect(getLedger(h).creator_accrued).toBe(0n);
  });

  it('withdraw_referral sends referral accrual and zeros it', async () => {
    const h = await deployInSimulator({
      basePrice: 10_000n,
      slope: 0n,
      maxSupply: 10n,
      feeBps: 100,
    });
    const buyer = new Uint8Array(32).fill(9);
    const referral = new Uint8Array(32).fill(7);
    const cost = curveCostBuy(0n, 1n, 10_000n, 0n);
    const cuts = rawCuts(cost, 100, 5000, 4000, 1000);
    h.buy({
      buyer,
      nTokens: 1n,
      curveCost: cost,
      feeTotal: cuts.fee,
      pCut: cuts.p,
      cCut: cuts.c,
      rCut: cuts.r,
      remainder: cuts.remainder,
      hasReferral: true,
      referral,
    });
    expect(getLedger(h).referrals_accrued.lookup(referral)).toBe(cuts.r);
    h.withdrawReferral({ ref: referral });
    expect(getLedger(h).referrals_accrued.lookup(referral)).toBe(0n);
  });

  it('transfer moves balance; tokens_sold and night_reserve unchanged', async () => {
    const h = await deployInSimulator({ feeBps: 0 });
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    const cost = curveCostBuy(0n, 100n, 1000n, 1n);
    h.buy({
      buyer: a,
      nTokens: 100n,
      curveCost: cost,
      feeTotal: 0n,
      pCut: 0n,
      cCut: 0n,
      rCut: 0n,
      remainder: 0n,
      hasReferral: false,
      referral: EMPTY_REF,
    });
    const preTokens = getLedger(h).tokens_sold;
    const preReserve = getLedger(h).night_reserve;
    h.transfer({ fromAddr: a, toAddr: b, amount: 30n });
    const s = getLedger(h);
    expect(s.tokens_sold).toBe(preTokens);
    expect(s.night_reserve).toBe(preReserve);
    expect(s.balances.lookup(a)).toBe(70n);
    expect(s.balances.lookup(b)).toBe(30n);
  });

  it('transfer beyond balance rejected', async () => {
    const h = await deployInSimulator({ feeBps: 0 });
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    const cost = curveCostBuy(0n, 10n, 1000n, 1n);
    h.buy({
      buyer: a,
      nTokens: 10n,
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
      h.transfer({ fromAddr: a, toAddr: b, amount: 11n }),
    ).toThrow();
  });
});
