import { TOTAL_SUPPLY, VIRTUAL_ADA, GRADUATION_ADA } from './config.js';

export interface CurveState {
  adaReserve: bigint;   // real ADA locked in the curve (lovelace)
  tokenReserve: bigint; // tokens remaining unsold in the curve
}

// State at token launch: zero real ADA, full supply available
export function initialState(): CurveState {
  return { adaReserve: 0n, tokenReserve: TOTAL_SUPPLY };
}

// How many tokens a buyer receives for adaIn lovelace (before platform fee is added on top)
export function quoteBuy(state: CurveState, adaIn: bigint): bigint {
  if (adaIn <= 0n) return 0n;
  const effective = state.adaReserve + VIRTUAL_ADA;
  const k = effective * state.tokenReserve;
  const newEffective = effective + adaIn;
  // Floor division: buyer gets slightly fewer tokens, keeping k non-decreasing
  const newTokenReserve = k / newEffective;
  return state.tokenReserve - newTokenReserve;
}

// Gross ADA a seller receives for tokensIn before fees are deducted
export function quoteSellGross(state: CurveState, tokensIn: bigint): bigint {
  if (tokensIn <= 0n) return 0n;
  const effective = state.adaReserve + VIRTUAL_ADA;
  const k = effective * state.tokenReserve;
  const newTokenReserve = state.tokenReserve + tokensIn;
  // Floor division: gives seller slightly more ADA — capped at adaReserve for safety
  const newEffective = k / newTokenReserve;
  const gross = effective - newEffective;
  return gross > state.adaReserve ? state.adaReserve : gross;
}

// Simulate a buy; returns updated state and tokens received
export function applyBuy(
  state: CurveState,
  adaIn: bigint,
): { state: CurveState; tokensOut: bigint } {
  const tokensOut = quoteBuy(state, adaIn);
  return {
    tokensOut,
    state: {
      adaReserve: state.adaReserve + adaIn,
      tokenReserve: state.tokenReserve - tokensOut,
    },
  };
}

// Simulate a sell; returns updated state and gross ADA before fees
export function applySell(
  state: CurveState,
  tokensIn: bigint,
): { state: CurveState; adaGross: bigint } {
  const adaGross = quoteSellGross(state, tokensIn);
  return {
    adaGross,
    state: {
      adaReserve: state.adaReserve - adaGross,
      tokenReserve: state.tokenReserve + tokensIn,
    },
  };
}

// Spot price in lovelace per token at the current reserves
export function spotPrice(state: CurveState): bigint {
  if (state.tokenReserve === 0n) throw new Error('token_reserve is zero');
  return (state.adaReserve + VIRTUAL_ADA) / state.tokenReserve;
}

// Approximate market cap in lovelace (spot price × total supply)
export function marketCap(state: CurveState): bigint {
  return spotPrice(state) * TOTAL_SUPPLY;
}

// Percentage of graduation threshold reached, in basis points (0–10000)
export function bondedBps(state: CurveState): bigint {
  return (state.adaReserve * 10000n) / GRADUATION_ADA;
}

export function isGraduated(state: CurveState): boolean {
  return state.adaReserve >= GRADUATION_ADA;
}
