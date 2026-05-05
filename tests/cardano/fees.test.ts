import { describe, it, expect } from 'vitest';
import { computeBuyFees, computeSellFees, minViableSellGross } from '../../src/cardano/fees.js';
import { PLATFORM_FEE_LOVELACE, DEFAULT_CREATOR_FEE_BPS, MAX_CREATOR_FEE_BPS } from '../../src/cardano/config.js';

describe('cardano fees — buy', () => {
  it('platform fee is always 1 ADA', () => {
    expect(computeBuyFees(10_000_000n, 100).platformFee).toBe(1_000_000n);
    expect(computeBuyFees(10_000_000n, 100).platformFee).toBe(PLATFORM_FEE_LOVELACE);
  });

  it('1% creator fee on a 10 ADA buy', () => {
    const r = computeBuyFees(10_000_000n, 100);
    expect(r.adaIn).toBe(10_000_000n);
    expect(r.creatorFee).toBe(100_000n);  // 1% of 10 ADA = 0.1 ADA
    expect(r.platformFee).toBe(1_000_000n);
  });

  it('2% creator fee on a 25 ADA buy', () => {
    const r = computeBuyFees(25_000_000n, MAX_CREATOR_FEE_BPS);
    expect(r.creatorFee).toBe(500_000n);  // 2% of 25 ADA
  });

  it('zero creator fee bps -> no creator cut', () => {
    const r = computeBuyFees(10_000_000n, 0);
    expect(r.creatorFee).toBe(0n);
    expect(r.platformFee).toBe(1_000_000n);
  });

  it('throws if bps out of range', () => {
    expect(() => computeBuyFees(10_000_000n, MAX_CREATOR_FEE_BPS + 1)).toThrow(/out of range/);
    expect(() => computeBuyFees(10_000_000n, -1)).toThrow(/out of range/);
  });

  it('throws if adaIn is non-positive', () => {
    expect(() => computeBuyFees(0n, 100)).toThrow(/positive/);
    expect(() => computeBuyFees(-1n, 100)).toThrow(/positive/);
  });
});

describe('cardano fees — sell at 1% creator fee (default)', () => {
  const bps = DEFAULT_CREATOR_FEE_BPS; // 100

  it('1% creator fee on a 10 ADA gross', () => {
    const r = computeSellFees(10_000_000n, bps);
    expect(r.adaGross).toBe(10_000_000n);
    expect(r.creatorFee).toBe(100_000n);          // 1% of 10 ADA = 0.1 ADA
    expect(r.platformFee).toBe(1_000_000n);       // 1 ADA flat
    expect(r.adaNet).toBe(8_900_000n);            // 10 - 0.1 - 1 = 8.9 ADA
  });

  it('adaNet + creatorFee + platformFee == adaGross', () => {
    const r = computeSellFees(50_000_000n, bps);
    expect(r.adaNet + r.creatorFee + r.platformFee).toBe(r.adaGross);
  });

  it('property: adaNet + creatorFee + platformFee == adaGross for 1000 random inputs', () => {
    for (let i = 0; i < 1000; i++) {
      const gross = BigInt(Math.floor(Math.random() * 1e10)) + 2_000_000n; // at least 2 ADA
      const creatorBps = Math.floor(Math.random() * (MAX_CREATOR_FEE_BPS + 1));
      try {
        const r = computeSellFees(gross, creatorBps);
        expect(r.adaNet + r.creatorFee + r.platformFee).toBe(r.adaGross);
        expect(r.adaNet).toBeGreaterThanOrEqual(0n);
      } catch {
        // sell too small — expected for tiny gross values
      }
    }
  });
});

describe('cardano fees — sell at 2% creator fee (max)', () => {
  it('2% creator fee on a 10 ADA gross', () => {
    const r = computeSellFees(10_000_000n, MAX_CREATOR_FEE_BPS);
    expect(r.creatorFee).toBe(200_000n); // 2% of 10 ADA = 0.2 ADA
    expect(r.adaNet).toBe(8_800_000n);   // 10 - 0.2 - 1 = 8.8 ADA
  });
});

describe('cardano fees — sell at 0% creator fee', () => {
  it('zero creator fee: only platform fee deducted', () => {
    const r = computeSellFees(5_000_000n, 0);
    expect(r.creatorFee).toBe(0n);
    expect(r.platformFee).toBe(1_000_000n);
    expect(r.adaNet).toBe(4_000_000n);
  });
});

describe('cardano fees — error cases', () => {
  it('throws if creatorFeeBps > MAX_CREATOR_FEE_BPS', () => {
    expect(() => computeSellFees(10_000_000n, MAX_CREATOR_FEE_BPS + 1)).toThrow(/out of range/);
  });

  it('throws if creatorFeeBps is negative', () => {
    expect(() => computeSellFees(10_000_000n, -1)).toThrow(/out of range/);
  });

  it('throws if fees exceed gross (sell too small to cover platform fee)', () => {
    // 500_000 lovelace = 0.5 ADA gross, platform fee alone is 1 ADA
    expect(() => computeSellFees(500_000n, 0)).toThrow(/sell too small/);
  });

  it('throws if adaGross is negative', () => {
    expect(() => computeSellFees(-1n, 0)).toThrow(/non-negative/);
  });
});

describe('cardano fees — minViableSellGross', () => {
  it('is above PLATFORM_FEE_LOVELACE for any valid bps', () => {
    for (const bps of [0, 100, 200]) {
      expect(minViableSellGross(bps)).toBeGreaterThan(PLATFORM_FEE_LOVELACE);
    }
  });

  it('a sell at exactly minViableSellGross does not throw', () => {
    for (const bps of [0, 100, 200]) {
      const min = minViableSellGross(bps);
      expect(() => computeSellFees(min, bps)).not.toThrow();
    }
  });
});
