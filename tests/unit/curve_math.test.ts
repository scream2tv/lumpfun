import { describe, it, expect } from 'vitest';
import { curveCostBuy, curvePayoutSell } from '../../src/curve.js';

describe('curve math', () => {
  const base = 1000n;
  const slope = 1n;

  it('zero-delta cost is zero', () => {
    expect(curveCostBuy(0n, 0n, base, slope)).toBe(0n);
  });

  it('single-token cost from zero supply is base_price', () => {
    // from=0, delta=1 → base*1 + slope*(0*1 + 1*0/2) = base
    expect(curveCostBuy(0n, 1n, base, slope)).toBe(1000n);
  });

  it('two-token cost from zero supply is 2*base + slope', () => {
    // from=0, delta=2 → base*2 + slope*(0 + 2*1/2) = 2*base + slope = 2001
    expect(curveCostBuy(0n, 2n, base, slope)).toBe(2001n);
  });

  it('buy then sell round-trips to zero residual', () => {
    for (const delta of [1n, 2n, 7n, 100n, 1337n]) {
      const cost = curveCostBuy(0n, delta, base, slope);
      const payout = curvePayoutSell(delta, delta, base, slope);
      expect(payout).toBe(cost);
    }
  });

  it('sequential buys sum equals single buy of the total', () => {
    const totalDirect = curveCostBuy(0n, 100n, base, slope);
    let totalPiecewise = 0n;
    let from = 0n;
    for (const chunk of [10n, 20n, 30n, 40n]) {
      totalPiecewise += curveCostBuy(from, chunk, base, slope);
      from += chunk;
    }
    expect(totalPiecewise).toBe(totalDirect);
  });

  it('matches closed-form: base*Δ + slope*(from*Δ + Δ*(Δ-1)/2)', () => {
    const from = 42n;
    const delta = 17n;
    const expected = base * delta + slope * (from * delta + delta * (delta - 1n) / 2n);
    expect(curveCostBuy(from, delta, base, slope)).toBe(expected);
  });
});
