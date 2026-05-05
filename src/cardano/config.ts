// Cardano LumpFun protocol constants — all ADA amounts in lovelace (1 ADA = 1_000_000 lovelace)

// Token supply
export const TOTAL_SUPPLY = 1_000_000_000n; // 1 billion tokens, 0 decimals

// Bonding curve parameters
export const VIRTUAL_ADA = 3_000_000_000n;   // 3,000 ADA — sets starting price without seeding real liquidity
// Default graduation threshold (lovelace). The on-chain validator now takes
// graduation_ada as a parameter, so per-token launches can override this with
// a smaller value (e.g. 5_000_000n = 5 ADA) for cheap end-to-end testing.
export const GRADUATION_ADA = 21_000_000_000n; // 21,000 ADA

// Cardano network minimums
export const MIN_UTXO_LOVELACE = 2_000_000n; // 2 ADA Cardano min-UTxO

// Fees
export const PLATFORM_FEE_LOVELACE = 1_000_000n; // 1 ADA flat per trade → protocol owner
export const DEFAULT_CREATOR_FEE_BPS = 100;       // 1% of gross ADA on sells → token creator
export const MAX_CREATOR_FEE_BPS = 200;           // 2% ceiling

// Launch constraints
export const MAX_DEV_ALLOC_BPS = 500;                 // 5% max dev token allocation at launch
export const MAX_INITIAL_BUY_LOVELACE = 150_000_000n; // 150 ADA cap on optional initial buy
