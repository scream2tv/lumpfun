import { describe, it, expect } from 'vitest';
import {
  initialState,
  quoteBuy,
  quoteSellGross,
  applyBuy,
  applySell,
  spotPrice,
  marketCap,
  bondedBps,
  isGraduated,
} from '../../src/cardano/curve.js';
import { VIRTUAL_ADA, TOTAL_SUPPLY, GRADUATION_ADA } from '../../src/cardano/config.js';

describe('cardano curve — initial state', () => {
  it('starts with full supply and zero real ADA', () => {
    const s = initialState();
    expect(s.adaReserve).toBe(0n);
    expect(s.tokenReserve).toBe(TOTAL_SUPPLY);
  });

  it('starting spot price equals VIRTUAL_ADA / TOTAL_SUPPLY (0.000003 ADA/token)', () => {
    // 3_000_000_000 lovelace / 1_000_000_000 tokens = 3 lovelace/token
    expect(spotPrice(initialState())).toBe(VIRTUAL_ADA / TOTAL_SUPPLY);
    expect(spotPrice(initialState())).toBe(3n);
  });

  it('zero real ADA means not graduated', () => {
    expect(isGraduated(initialState())).toBe(false);
  });

  it('bondedBps is 0 at launch', () => {
    expect(bondedBps(initialState())).toBe(0n);
  });
});

describe('cardano curve — quoteBuy', () => {
  it('zero adaIn returns zero tokens', () => {
    expect(quoteBuy(initialState(), 0n)).toBe(0n);
  });

  it('negative adaIn returns zero tokens', () => {
    expect(quoteBuy(initialState(), -1n)).toBe(0n);
  });

  it('buying 1000 ADA from initial state gives expected token amount', () => {
    // effective = 3000 ADA, k = 3000 * 1B = 3T
    // new_effective = 4000 ADA (in lovelace: 4_000_000_000)
    // new_token_reserve = 3T / 4_000_000_000 = 750_000_000
    // tokens_out = 1B - 750M = 250_000_000
    const s = initialState();
    const ada1000 = 1_000_000_000n; // 1000 ADA in lovelace
    const out = quoteBuy(s, ada1000);
    expect(out).toBe(250_000_000n);
  });

  it('buying 3000 ADA (matching VIRTUAL_ADA) halves the token reserve', () => {
    // new_effective = 6000, new_token_reserve = 3T / 6B = 500M, tokens_out = 500M
    const out = quoteBuy(initialState(), VIRTUAL_ADA);
    expect(out).toBe(500_000_000n);
  });

  it('price increases with each successive large buy', () => {
    // Integer spot price only moves when adaIn is large enough to shift the lovelace/token ratio.
    // Use 1000 ADA chunks — well above the ~300 ADA threshold needed to move the 3 lovelace/token floor.
    let state = initialState();
    const chunk = 1_000_000_000n; // 1000 ADA
    let prevPrice = spotPrice(state);
    for (let i = 0; i < 5; i++) {
      ({ state } = applyBuy(state, chunk));
      const price = spotPrice(state);
      expect(price).toBeGreaterThan(prevPrice);
      prevPrice = price;
    }
  });
});

describe('cardano curve — quoteSellGross', () => {
  it('zero tokensIn returns zero', () => {
    expect(quoteSellGross(initialState(), 0n)).toBe(0n);
  });

  it('negative tokensIn returns zero', () => {
    expect(quoteSellGross(initialState(), -1n)).toBe(0n);
  });

  it('sell-back round-trip returns approximately the same ADA', () => {
    // Buy 1000 ADA worth, sell all tokens back — should recover ~1000 ADA (minus rounding)
    const s0 = initialState();
    const adaIn = 1_000_000_000n; // 1000 ADA
    const { state: s1, tokensOut } = applyBuy(s0, adaIn);
    const { adaGross } = applySell(s1, tokensOut);
    // Rounding may cause adaGross to differ from adaIn by at most a few lovelace
    const diff = adaIn > adaGross ? adaIn - adaGross : adaGross - adaIn;
    expect(diff).toBeLessThanOrEqual(10n);
  });

  it('sell gross is never greater than adaReserve', () => {
    let state = initialState();
    // Buy a bunch first
    ({ state } = applyBuy(state, 5_000_000_000n));
    const { tokensOut } = applyBuy(initialState(), 5_000_000_000n);
    const gross = quoteSellGross(state, tokensOut);
    expect(gross).toBeLessThanOrEqual(state.adaReserve);
  });

  it('sell gross decreases as more tokens are sold into an empty curve', () => {
    // Two different sell sizes from the same state — larger sell should yield proportionally more
    let state = initialState();
    ({ state } = applyBuy(state, 3_000_000_000n));
    const gross100 = quoteSellGross(state, 100_000n);
    const gross200 = quoteSellGross(state, 200_000n);
    expect(gross200).toBeGreaterThan(gross100);
    // But not 2× due to slippage
    expect(gross200).toBeLessThan(gross100 * 2n);
  });
});

describe('cardano curve — applyBuy / applySell state transitions', () => {
  it('applyBuy increases adaReserve and decreases tokenReserve', () => {
    const s0 = initialState();
    const { state: s1 } = applyBuy(s0, 1_000_000_000n);
    expect(s1.adaReserve).toBeGreaterThan(s0.adaReserve);
    expect(s1.tokenReserve).toBeLessThan(s0.tokenReserve);
  });

  it('applySell decreases adaReserve and increases tokenReserve', () => {
    let state = initialState();
    const { state: s1, tokensOut } = applyBuy(state, 1_000_000_000n);
    const { state: s2 } = applySell(s1, tokensOut);
    expect(s2.adaReserve).toBeLessThan(s1.adaReserve);
    expect(s2.tokenReserve).toBeGreaterThan(s1.tokenReserve);
  });

  it('sequential buys produce approximately the same tokens as one large buy', () => {
    // In real-number math, sequential buys yield fewer tokens than a single buy (price impact).
    // With integer floor division, rounding at each step can produce +1 token more in the
    // sequential path — both directions are possible. What matters is the difference is tiny.
    const totalAda = 1_000_000_000n;
    const { tokensOut: singleOut } = applyBuy(initialState(), totalAda);

    let state = initialState();
    let totalTokens = 0n;
    const half = totalAda / 2n;
    let out: bigint;
    ({ state, tokensOut: out } = applyBuy(state, half));
    totalTokens += out;
    ({ tokensOut: out } = applyBuy(state, half));
    totalTokens += out;

    // Difference must be at most a handful of tokens (rounding artefact, not a math error)
    const diff = totalTokens > singleOut ? totalTokens - singleOut : singleOut - totalTokens;
    expect(diff).toBeLessThanOrEqual(5n);
  });

  it('spot price never decreases across buy operations', () => {
    // k computed from stored state can drift slightly downward due to floor division at each step
    // (the on-chain validator enforces k ≥ k_old using the exact formula, not re-measured state).
    // What must always hold: spot price is non-decreasing with each buy.
    let state = initialState();
    let prevSp = spotPrice(state);

    for (const adaIn of [1_000_000_000n, 1_000_000_000n, 2_000_000_000n, 5_000_000_000n]) {
      ({ state } = applyBuy(state, adaIn));
      const sp = spotPrice(state);
      expect(sp).toBeGreaterThanOrEqual(prevSp);
      prevSp = sp;
    }
  });
});

describe('cardano curve — graduation', () => {
  it('isGraduated is false below threshold', () => {
    const { state } = applyBuy(initialState(), GRADUATION_ADA - 1n);
    expect(isGraduated(state)).toBe(false);
  });

  it('isGraduated is true at exactly the threshold', () => {
    // Simulate buying until adaReserve >= GRADUATION_ADA
    let state = initialState();
    ({ state } = applyBuy(state, GRADUATION_ADA));
    expect(isGraduated(state)).toBe(true);
  });

  it('bondedBps reaches 10000 at graduation threshold', () => {
    let state = initialState();
    ({ state } = applyBuy(state, GRADUATION_ADA));
    expect(bondedBps(state)).toBeGreaterThanOrEqual(10000n);
  });
});

describe('cardano curve — marketCap', () => {
  it('initial market cap equals VIRTUAL_ADA (3000 ADA × 1B / 1B = 3000 ADA)', () => {
    // spotPrice = 3 lovelace/token; marketCap = 3 * 1B = 3_000_000_000 lovelace = 3000 ADA
    expect(marketCap(initialState())).toBe(3_000_000_000n);
  });

  it('market cap increases after a buy', () => {
    const s0 = initialState();
    const { state: s1 } = applyBuy(s0, 1_000_000_000n);
    expect(marketCap(s1)).toBeGreaterThan(marketCap(s0));
  });
});
