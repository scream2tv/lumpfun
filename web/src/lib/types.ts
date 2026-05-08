export interface TokenMeta {
  policyId: string;
  assetName: string; // hex
  ticker: string;
  name: string;
  curveAddress: string;
  creatorAddress: string;
  creatorFeeBps: number;
  validatorCbor: string; // parameterised bonding curve script for this token
  /** Per-launch creator fee accumulator. New launches route every trade's
   *  creator-fee output here so fees pile up at one script address; the
   *  creator sweeps via claimCreatorFees. Tokens launched before this
   *  feature have these fields undefined and pay fees to creatorAddress. */
  feeAccumulatorAddress?: string;
  feeAccumulatorValidatorCbor?: string;
  /** Most recent successful claim tx hash (best-effort display). */
  feeAccumulatorClaimedTxHash?: string;
  /** Lovelace threshold this curve was parameterised with at launch — defaults
   *  to 21,000 ADA. Stored as a string so JSON.stringify doesn't choke on bigint. */
  graduationAdaLovelace?: string;
  /** Creator dev allocation vesting (optional). When set at launch, the dev
   *  tokens are locked at vestingAddress until vestingUnlockMs (POSIX ms),
   *  claimable by the creator only via claimVestedTokens. */
  vestingAddress?: string;
  vestingValidatorCbor?: string;
  vestingUnlockMs?: number;
  vestingClaimedTxHash?: string;
  /** Additional creator-initiated lockups added after launch via the
   *  re-vest flow. Each entry is its own per-launch vesting script
   *  (parameterised with creator_pkh + unlock_posix_ms) so positions
   *  with different unlock times don't share a script address. */
  extraVestings?: Array<{
    address: string;
    validatorCbor: string;
    unlockMs: number;
    addedAt: string; // ISO
    claimedTxHash?: string;
  }>;
  imageUri?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  launchedAt: string; // ISO

  // ── Graduation state ─────────────────────────────────────────────────────
  // Set after Tx 1 (drain curve to treasury via Graduate redeemer).
  graduatedTxHash?: string;
  graduatedAt?: string; // ISO
  // Pre-drain curve reserves, captured at drain time so a later resumed
  // pool-creation tx can recompute the Minswap quote without re-reading the
  // (now-spent) curve UTxO. Strings for JSON-safe bigint storage.
  preDrainAdaReserve?: string;
  preDrainTokenReserve?: string;
  // Set after Tx 2 (Minswap V2 pool creation from treasury wallet).
  minswapPoolTxHash?: string;
  minswapPoolId?: string;
  // ADA + token amounts that went into the pool, for display/audit.
  poolAdaLovelace?: string;
  poolTokens?: string;
}

export interface CurveState {
  adaReserve: bigint;
  tokenReserve: bigint;
}

export interface TokenInfo extends TokenMeta {
  adaReserve: bigint;
  tokenReserve: bigint;
  priceLovelace: bigint;
  marketCapAda: number;
  bondedPct: number;
  graduated: boolean;
}

export interface Trade {
  txHash: string;
  type: 'buy' | 'sell';
  lovelace: bigint;
  tokens: bigint;
  address: string;
  timestamp: string;
}

export type SortMode = 'new' | 'trending' | 'graduating';

export interface WalletInfo {
  address: string;
  lovelace: bigint;
  name: string;
  /** Payment-credential hash (hex) derived from `address`. Cached on the
   *  wallet object so the queue-mode UI can match the wallet against
   *  OrderDatum.ownerPkh without re-deriving on every render. */
  pkh: string;
}
