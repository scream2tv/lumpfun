// Mirror of src/cardano/graduate.ts — kept browser/server-safe (no Node deps).
import { VIRTUAL_ADA, GRADUATION_ADA } from './curve-math';

export interface CurveStateBig {
  adaReserve:   bigint;
  tokenReserve: bigint;
}

export const MIN_LOCKED_LP = 10n;

export interface GraduationQuote {
  adaForPool:           bigint;
  tokensForPool:        bigint;
  surplusTokens:        bigint;
  closingPriceLovelace: bigint;
}

/**
 * Pool opens at exactly the bonding curve's closing price to avoid arbitrage.
 *
 *   pool_price = adaForPool / tokensForPool
 *             = adaReserve / (adaReserve × tokenReserve / (adaReserve + VIRTUAL_ADA))
 *             = (adaReserve + VIRTUAL_ADA) / tokenReserve   ← matches curve close ✓
 *
 * @param graduationThreshold per-token threshold in lovelace. Falls back to the
 *   global GRADUATION_ADA so existing callers keep working.
 */
export function computeGraduationQuote(
  state: CurveStateBig,
  graduationThreshold: bigint = GRADUATION_ADA,
): GraduationQuote {
  if (state.adaReserve < graduationThreshold) {
    throw new Error(
      `curve has not reached graduation threshold: adaReserve=${state.adaReserve}, required=${graduationThreshold}`,
    );
  }
  const adaForPool       = state.adaReserve;
  const effectiveReserve = state.adaReserve + VIRTUAL_ADA;
  const tokensForPool    = (adaForPool * state.tokenReserve) / effectiveReserve;
  const surplusTokens    = state.tokenReserve - tokensForPool;
  const closingPriceLovelace = effectiveReserve / state.tokenReserve;
  return { adaForPool, tokensForPool, surplusTokens, closingPriceLovelace };
}
