export interface TokenMeta {
  policyId: string;
  assetName: string; // hex
  ticker: string;
  name: string;
  curveAddress: string;
  creatorAddress: string;
  creatorFeeBps: number;
  validatorCbor: string; // parameterised bonding curve script for this token
  /** Lovelace threshold this curve was parameterised with at launch — defaults
   *  to 21,000 ADA. Stored as a string so JSON.stringify doesn't choke on bigint. */
  graduationAdaLovelace?: string;
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
}
