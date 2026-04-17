import { describe, it, expect } from 'vitest';
import { computeFeeSplit } from '../../src/fees.js';

const shares = { platformShareBps: 5000, creatorShareBps: 4000, referralShareBps: 1000 };

describe('fees', () => {
  it('clean case: curve_cost=1_000_000_007, fee_bps=100', () => {
    const r = computeFeeSplit({ curveSide: 1_000_000_007n, feeBps: 100, ...shares, referralPresent: true });
    expect(r.fee).toBe(10_000_000n);
    expect(r.split.platform).toBe(5_000_000n);
    expect(r.split.creator).toBe(4_000_000n);
    expect(r.split.referral).toBe(1_000_000n);
    expect(r.split.platform + r.split.creator + r.split.referral).toBe(r.fee);
  });

  it('rounding case: curve_cost=999, fee_bps=100 → fee=9, p=6, c=3, r=0', () => {
    const r = computeFeeSplit({ curveSide: 999n, feeBps: 100, ...shares, referralPresent: true });
    expect(r.fee).toBe(9n);
    expect(r.split.platform).toBe(6n);   // 4 + remainder 2
    expect(r.split.creator).toBe(3n);
    expect(r.split.referral).toBe(0n);
    expect(r.split.platform + r.split.creator + r.split.referral).toBe(r.fee);
  });

  it('absent referral: referral cut routed to platform', () => {
    const r = computeFeeSplit({ curveSide: 1_000_000_000n, feeBps: 100, ...shares, referralPresent: false });
    expect(r.fee).toBe(10_000_000n);
    expect(r.split.platform).toBe(5_000_000n + 1_000_000n); // platform + referral cut
    expect(r.split.creator).toBe(4_000_000n);
    expect(r.split.referral).toBe(0n);
  });

  it('zero fee_bps: no fee, no split', () => {
    const r = computeFeeSplit({ curveSide: 1_000_000_000n, feeBps: 0, ...shares, referralPresent: true });
    expect(r.fee).toBe(0n);
    expect(r.split.platform).toBe(0n);
    expect(r.split.creator).toBe(0n);
    expect(r.split.referral).toBe(0n);
  });

  it('asserts share sum == 10000', () => {
    expect(() =>
      computeFeeSplit({
        curveSide: 1000n,
        feeBps: 100,
        platformShareBps: 5000,
        creatorShareBps: 4000,
        referralShareBps: 500, // only 9500
        referralPresent: true,
      })
    ).toThrow(/share sum/i);
  });

  it('asserts fee_bps <= 2000', () => {
    expect(() =>
      computeFeeSplit({ curveSide: 1000n, feeBps: 2001, ...shares, referralPresent: true }),
    ).toThrow(/fee_bps/i);
  });

  it('property: p + c + r == fee for 1000 random inputs', () => {
    for (let i = 0; i < 1000; i++) {
      const curveSide = BigInt(Math.floor(Math.random() * 1e15));
      const feeBps = Math.floor(Math.random() * 2001);
      const p = Math.floor(Math.random() * 10001);
      const c = Math.floor(Math.random() * (10001 - p));
      const rBps = 10000 - p - c;
      const ref = Math.random() < 0.5;
      const r = computeFeeSplit({
        curveSide,
        feeBps,
        platformShareBps: p,
        creatorShareBps: c,
        referralShareBps: rBps,
        referralPresent: ref,
      });
      expect(r.split.platform + r.split.creator + r.split.referral).toBe(r.fee);
    }
  });
});
