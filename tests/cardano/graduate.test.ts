import { describe, it, expect } from 'vitest';
import {
  computeGraduationQuote,
  assertPriceContinuity,
  intSqrt,
  intSqrtCeil,
  MIN_LOCKED_LP,
} from '../../src/cardano/graduate.js';
import { applyBuy, initialState } from '../../src/cardano/curve.js';
import { GRADUATION_ADA, VIRTUAL_ADA, TOTAL_SUPPLY } from '../../src/cardano/config.js';

// Helper: buy enough ADA to graduate the curve
function graduatedState() {
  let state = initialState();
  ({ state } = applyBuy(state, GRADUATION_ADA));
  return state;
}

describe('intSqrt', () => {
  it('sqrt(0) = 0', () => expect(intSqrt(0n)).toBe(0n));
  it('sqrt(1) = 1', () => expect(intSqrt(1n)).toBe(1n));
  it('sqrt(4) = 2', () => expect(intSqrt(4n)).toBe(2n));
  it('sqrt(9) = 3', () => expect(intSqrt(9n)).toBe(3n));
  it('sqrt(2) = 1 (floor)', () => expect(intSqrt(2n)).toBe(1n));
  it('sqrt(8) = 2 (floor)', () => expect(intSqrt(8n)).toBe(2n));

  it('result squared <= n < (result+1) squared for many values', () => {
    for (const n of [10n, 99n, 100n, 101n, 1_000_000n, 999_999_999_999n]) {
      const r = intSqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1n) * (r + 1n)).toBeGreaterThan(n);
    }
  });

  it('throws on negative input', () => {
    expect(() => intSqrt(-1n)).toThrow(/negative/);
  });
});

describe('computeGraduationQuote — error cases', () => {
  it('throws if curve has not reached graduation threshold', () => {
    let state = initialState();
    ({ state } = applyBuy(state, GRADUATION_ADA - 1_000_000n)); // 1 ADA short
    expect(() => computeGraduationQuote(state)).toThrow(/graduation threshold/);
  });
});

describe('computeGraduationQuote — pool amounts', () => {
  it('all real ADA goes into the pool', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);
    expect(q.adaForPool).toBe(state.adaReserve);
    expect(q.adaForPool).toBeGreaterThanOrEqual(GRADUATION_ADA);
  });

  it('tokensForPool + surplusTokens == tokenReserve at graduation', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);
    expect(q.tokensForPool + q.surplusTokens).toBe(state.tokenReserve);
  });

  it('tokensForPool is always less than total token supply', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);
    expect(q.tokensForPool).toBeLessThan(TOTAL_SUPPLY);
  });

  it('surplusTokens is non-negative', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);
    expect(q.surplusTokens).toBeGreaterThanOrEqual(0n);
  });
});

describe('computeGraduationQuote — price continuity', () => {
  it('pool price matches closing bonding curve price to within 1 lovelace/token', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);

    const curvePrice = (state.adaReserve + VIRTUAL_ADA) / state.tokenReserve;
    const poolPrice = q.adaForPool / q.tokensForPool;
    const diff = curvePrice > poolPrice ? curvePrice - poolPrice : poolPrice - curvePrice;

    expect(diff).toBeLessThanOrEqual(1n);
    expect(q.closingPriceLovelace).toBe(curvePrice);
  });

  it('assertPriceContinuity does not throw for a valid graduation', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);
    expect(() => assertPriceContinuity(q, state)).not.toThrow();
  });

  it('price continuity holds for various graduation points (partial buy-ins)', () => {
    // Token with 30k ADA in it (above threshold)
    let state = initialState();
    ({ state } = applyBuy(state, 30_000_000_000n));
    const q = computeGraduationQuote(state);

    const curvePrice = (state.adaReserve + VIRTUAL_ADA) / state.tokenReserve;
    const poolPrice = q.adaForPool / q.tokensForPool;
    const diff = curvePrice > poolPrice ? curvePrice - poolPrice : poolPrice - curvePrice;
    expect(diff).toBeLessThanOrEqual(1n);
  });
});

describe('computeGraduationQuote — LP token estimate', () => {
  it('estimated LP tokens is positive', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);
    expect(q.estimatedLpTokens).toBeGreaterThan(0n);
  });

  it('LP estimate equals ceil(sqrt(ada * tokens)) minus MIN_LOCKED_LP', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);

    const expectedLpTotal = intSqrtCeil(q.adaForPool * q.tokensForPool);
    const expectedNet = expectedLpTotal - MIN_LOCKED_LP;
    expect(q.estimatedLpTokens).toBe(expectedNet);
  });

  it('LP tokens increase with more liquidity at graduation', () => {
    // More buy-in before graduation → more ADA in pool → more LP tokens
    let stateA = initialState();
    ({ stateA } = { stateA: applyBuy(initialState(), GRADUATION_ADA).state });

    let stateB = initialState();
    ({ stateB } = { stateB: applyBuy(initialState(), GRADUATION_ADA * 2n).state });

    const lpA = computeGraduationQuote(stateA).estimatedLpTokens;
    const lpB = computeGraduationQuote(stateB).estimatedLpTokens;
    expect(lpB).toBeGreaterThan(lpA);
  });
});

describe('computeGraduationQuote — economic properties', () => {
  it('the virtual ADA is not included in the pool (only real ADA)', () => {
    // The pool gets adaReserve, NOT adaReserve + VIRTUAL_ADA
    // VIRTUAL_ADA was a pricing fiction — it was never real collateral
    const state = graduatedState();
    const q = computeGraduationQuote(state);
    expect(q.adaForPool).toBe(state.adaReserve);
    expect(q.adaForPool).toBeLessThan(state.adaReserve + VIRTUAL_ADA);
  });

  it('closing price is higher than starting price (3 lovelace/token)', () => {
    const state = graduatedState();
    const q = computeGraduationQuote(state);
    expect(q.closingPriceLovelace).toBeGreaterThan(VIRTUAL_ADA / TOTAL_SUPPLY); // > 3 lovelace/token
  });
});
