// TypeScript representations of on-chain Aiken types.
// These mirror lib/lumpfun/types.ak exactly.

// ── On-chain state ────────────────────────────────────────────────────────────

/** Inline datum on every bonding curve UTxO. */
export interface CurveDatum {
  adaReserve: bigint;   // lovelace
  tokenReserve: bigint; // raw token units (0 decimals)
}

// ── Redeemers ─────────────────────────────────────────────────────────────────

export type CurveRedeemer =
  | { tag: 'Buy';      minOut: bigint }
  | { tag: 'Sell';     minOut: bigint }
  | { tag: 'Graduate' };

export type OrderRedeemer = 'Execute' | 'Cancel';

// ── Order book ────────────────────────────────────────────────────────────────

export type OrderAction = 'Buy' | 'Sell';

/** Datum locked in the order book contract for a pending order. */
export interface OrderDatum {
  ownerPkh: string;          // hex pubkey hash
  curvePolicyId: string;     // hex policy ID
  curveAssetName: string;    // hex asset name
  action: OrderAction;
  amount: bigint;            // lovelace (buy) or token units (sell)
  minOut: bigint;            // slippage floor
  creatorPkh: string;        // hex pubkey hash
  treasuryPkh: string;       // hex pubkey hash
}

// ── Token launch parameters ───────────────────────────────────────────────────

export interface LaunchParams {
  /** Display name of the token (e.g. "My Token") */
  name: string;
  /** Ticker symbol (e.g. "MTK") */
  ticker: string;
  /** Creator fee in basis points (0–200). Defaults to DEFAULT_CREATOR_FEE_BPS. */
  creatorFeeBps?: number;
  /** Optional dev allocation in basis points (0–MAX_DEV_ALLOC_BPS = 500). */
  devAllocBps?: number;
  /** Optional initial buy in lovelace (0–MAX_INITIAL_BUY_LOVELACE = 150 ADA). */
  initialBuyLovelace?: bigint;
  /** Optional graduation threshold (lovelace). Defaults to GRADUATION_ADA. Lower
   *  values let you test the full launch → graduate → Minswap flow with very
   *  little ADA (e.g. 5_000_000n on mainnet for a 5 ADA threshold). */
  graduationAdaLovelace?: bigint;
  /** Optional IPFS URI for token image. */
  imageUri?: string;
  /** Optional description. */
  description?: string;
}

// ── Transaction result shapes ─────────────────────────────────────────────────

export interface LaunchResult {
  txHash: string;
  policyId: string;
  assetName: string;
  curveAddress: string;
  /** Seed UTxO consumed to parameterise the one-shot minting policy. */
  seedTxHash: string;
  seedOutputIndex: number;
  /** Parameterised bonding curve script CBOR (hex) ready for buy/sell calls. */
  validatorCbor: string;
}

export interface TradeResult {
  txHash: string;
  /** Tokens received (buy) or ADA gross received (sell), in base units. */
  amount: bigint;
}

export interface GraduationResult {
  txHash: string;
  minswapPoolId: string;
  lpTokensToCreator: bigint;
}

// ── Curve UTxO (resolved from chain) ─────────────────────────────────────────

export interface CurveUtxo {
  txHash: string;
  outputIndex: number;
  datum: CurveDatum;
  lovelace: bigint;
  tokens: bigint;
  policyId: string;
  assetName: string;
}
