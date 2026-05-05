import { PLATFORM_FEE_LOVELACE, MAX_CREATOR_FEE_BPS } from './config.js';

export interface BuyFees {
  adaIn: bigint;       // lovelace going into the curve (curve.ada_reserve delta)
  platformFee: bigint; // flat 1 ADA → protocol owner; charged on top of adaIn
  creatorFee: bigint;  // BPS% of adaIn → token creator (paid in same tx, not accrued)
}

export interface SellFees {
  adaGross: bigint;   // gross ADA from the curve before deductions
  creatorFee: bigint; // BPS% of adaGross → token creator
  platformFee: bigint; // flat 1 ADA → protocol owner
  adaNet: bigint;     // what the seller actually receives
}

// Platform 1 ADA is flat per trade. Creator gets BPS of adaIn — same shape as
// the sell side, but applied to the buy gross (the lovelace flowing into the
// curve), so the on-chain validator can recompute it identically.
export function computeBuyFees(adaIn: bigint, creatorFeeBps: number): BuyFees {
  if (!Number.isInteger(creatorFeeBps) || creatorFeeBps < 0 || creatorFeeBps > MAX_CREATOR_FEE_BPS) {
    throw new Error(
      `creatorFeeBps out of range: ${creatorFeeBps} (must be integer 0–${MAX_CREATOR_FEE_BPS})`,
    );
  }
  if (adaIn <= 0n) throw new Error(`adaIn must be positive, got ${adaIn}`);

  const creatorFee = (adaIn * BigInt(creatorFeeBps)) / 10000n;
  return { adaIn, platformFee: PLATFORM_FEE_LOVELACE, creatorFee };
}

// Deduct creator rev-share and platform fee from the gross ADA a sell produces
export function computeSellFees(adaGross: bigint, creatorFeeBps: number): SellFees {
  if (!Number.isInteger(creatorFeeBps) || creatorFeeBps < 0 || creatorFeeBps > MAX_CREATOR_FEE_BPS) {
    throw new Error(
      `creatorFeeBps out of range: ${creatorFeeBps} (must be integer 0–${MAX_CREATOR_FEE_BPS})`,
    );
  }
  if (adaGross < 0n) throw new Error(`adaGross must be non-negative, got ${adaGross}`);

  const creatorFee = (adaGross * BigInt(creatorFeeBps)) / 10000n;
  const platformFee = PLATFORM_FEE_LOVELACE;
  const totalDeductions = creatorFee + platformFee;

  if (totalDeductions > adaGross) {
    // Fees exceed gross output — sell is too small to cover fees
    throw new Error(
      `sell too small: gross=${adaGross} lovelace, fees=${totalDeductions} lovelace`,
    );
  }

  return {
    adaGross,
    creatorFee,
    platformFee,
    adaNet: adaGross - totalDeductions,
  };
}

// Minimum gross ADA required so that after all fees adaNet >= 1 lovelace
export function minViableSellGross(creatorFeeBps: number): bigint {
  // adaNet = adaGross - floor(adaGross * bps / 10000) - PLATFORM_FEE >= 1
  // => adaGross * (10000 - bps) / 10000 >= PLATFORM_FEE + 1  (approximately)
  // => adaGross >= ceil((PLATFORM_FEE + 1) * 10000 / (10000 - bps))
  const denom = BigInt(10000 - creatorFeeBps);
  const num = (PLATFORM_FEE_LOVELACE + 1n) * 10000n;
  return (num + denom - 1n) / denom; // ceiling division
}
