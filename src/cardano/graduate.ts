import { CurveState, isGraduated } from './curve.js';
import { VIRTUAL_ADA, GRADUATION_ADA } from './config.js';

// ── Minswap v2 on-chain identifiers ─────────────────────────────────────────
// Sourced from grep.fun bundle + Minswap open-source contracts.
// TODO: verify preprod addresses against https://docs.minswap.org once confirmed.
export const MINSWAP = {
  mainnet: {
    poolScriptHash: 'ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b',
    factoryAddress: 'addr1z9aut775r22l2cd7ssmfvv0qudvftmaskulq5ayqhw0dwvzj2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pqgjw6pl',
    // TODO: verify mainnet LP policy ID against Minswap v2 deployment
    lpPolicyId: 'e4214b7cce62ac6fbba385d164df48e157eae5863521b4b67ca71d86',
  },
  preprod: {
    poolScriptHash: 'd6ba9b7509eac866288ff5072d2a18205ac56f744bc82dcd808cb8fe',
    factoryAddress: 'addr_test1zphz8lsh9dd4pc4dtxk7m8hg6jy0wnrlg6r0jxcrygs2mtvrajt8r8wqtygrfduwgukk73m5gcnplmztc5tl5ngy0upqjgg24z',
    lpPolicyId: 'd6aae2059baee188f74917493cf7637e679cd219bdfbbf4dcbeb1d0b',
  },
} as const;

// Minswap v2 charges a 1% LP fee (100 bps) on all trades in the pool.
// This is the fee that accrues to LP token holders (including the creator).
export const MINSWAP_LP_FEE_BPS = 100;

// ADA locked in the pool UTxO at creation (PoolV2.DEFAULT_POOL_ADA — stays as pool reserve, not a fee).
export const POOL_CREATION_DEPOSIT_LOVELACE = 4_500_000n; // 4.5 ADA per Minswap v2 SDK

// Minswap v2 permanently locks this many LP tokens to prevent empty-pool drain attacks.
export const MIN_LOCKED_LP = 10n;

// ── Types ────────────────────────────────────────────────────────────────────

export type SurplusDestination = 'treasury' | 'creator';

export interface GraduationQuote {
  /** All real ADA from the bonding curve goes into the Minswap pool */
  adaForPool: bigint;
  /** Tokens price-matched to the closing bonding curve price */
  tokensForPool: bigint;
  /** Remaining tokens not needed for the price-matched pool */
  surplusTokens: bigint;
  /** Closing spot price of the bonding curve (lovelace per token, floor) */
  closingPriceLovelace: bigint;
  /** Estimated LP tokens minted to the creator (geometric mean, minus MIN_LOCKED_LP) */
  estimatedLpTokens: bigint;
}

// ── Math helpers ─────────────────────────────────────────────────────────────

// Integer square root — floor (largest r where r² ≤ n)
export function intSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('intSqrt: negative input');
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// Integer square root — ceiling (smallest r where r² ≥ n)
// Minswap v2 uses ceil(sqrt(amountA * amountB)) for initial LP minting.
export function intSqrtCeil(n: bigint): bigint {
  const r = intSqrt(n);
  return r * r === n ? r : r + 1n;
}

// ── Core graduation quote ────────────────────────────────────────────────────

/**
 * Compute how much ADA and how many tokens go into the Minswap pool at graduation.
 *
 * Design: all real ADA from the bonding curve goes to the pool. The token amount is
 * chosen so the pool opens at exactly the bonding curve's closing price — this
 * eliminates arbitrage at the graduation boundary.
 *
 *   pool_price = adaForPool / tokensForPool
 *             = adaReserve / (adaReserve × tokenReserve / (adaReserve + VIRTUAL_ADA))
 *             = (adaReserve + VIRTUAL_ADA) / tokenReserve  ← closing bonding curve price ✓
 */
export function computeGraduationQuote(state: CurveState): GraduationQuote {
  if (!isGraduated(state)) {
    throw new Error(
      `curve has not reached graduation threshold: adaReserve=${state.adaReserve}, required=${GRADUATION_ADA}`,
    );
  }

  const adaForPool = state.adaReserve;
  const effectiveReserve = state.adaReserve + VIRTUAL_ADA; // closing price denominator

  // Price-matched token amount: adaForPool / tokensForPool = effectiveReserve / tokenReserve
  // => tokensForPool = adaForPool * tokenReserve / effectiveReserve  (floor division)
  const tokensForPool = (adaForPool * state.tokenReserve) / effectiveReserve;
  const surplusTokens = state.tokenReserve - tokensForPool;

  const closingPriceLovelace = effectiveReserve / state.tokenReserve; // floor

  // LP token estimate: Minswap v2 uses ceil(sqrt(adaForPool × tokensForPool))
  // Creator receives LP_total − MIN_LOCKED_LP (10 LP permanently locked in pool)
  const lpTotal = intSqrtCeil(adaForPool * tokensForPool);
  const estimatedLpTokens = lpTotal > MIN_LOCKED_LP ? lpTotal - MIN_LOCKED_LP : 0n;

  return {
    adaForPool,
    tokensForPool,
    surplusTokens,
    closingPriceLovelace,
    estimatedLpTokens,
  };
}

/**
 * Verify that the pool price matches the bonding curve closing price to within 1 lovelace/token.
 * Used by the off-chain tx builder before submitting the graduation tx.
 */
export function assertPriceContinuity(quote: GraduationQuote, state: CurveState): void {
  const curvePrice = (state.adaReserve + VIRTUAL_ADA) / state.tokenReserve;
  const poolPrice = quote.adaForPool / quote.tokensForPool;
  const diff = curvePrice > poolPrice ? curvePrice - poolPrice : poolPrice - curvePrice;
  if (diff > 1n) {
    throw new Error(
      `price discontinuity at graduation: curve=${curvePrice}, pool=${poolPrice}, diff=${diff}`,
    );
  }
}
