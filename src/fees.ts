export interface FeeSplitInput {
  curveSide: bigint;       // curve_cost (buy) or curve_payout (sell)
  feeBps: number;          // 0..2000
  platformShareBps: number;
  creatorShareBps: number;
  referralShareBps: number;
  referralPresent: boolean;
}

export interface FeeSplit {
  fee: bigint;
  split: {
    platform: bigint;
    creator: bigint;
    referral: bigint;      // 0 when referralPresent is false
  };
}

const BPS = 10000n;
const MAX_FEE_BPS = 2000;

export function computeFeeSplit(input: FeeSplitInput): FeeSplit {
  const { curveSide, feeBps, platformShareBps, creatorShareBps, referralShareBps, referralPresent } = input;

  if (feeBps < 0 || feeBps > MAX_FEE_BPS) {
    throw new Error(`fee_bps out of range: ${feeBps} (max ${MAX_FEE_BPS})`);
  }
  if (platformShareBps + creatorShareBps + referralShareBps !== 10000) {
    throw new Error(
      `share sum must equal 10000 (got ${platformShareBps + creatorShareBps + referralShareBps})`,
    );
  }

  if (feeBps === 0) {
    return { fee: 0n, split: { platform: 0n, creator: 0n, referral: 0n } };
  }

  const fee = (curveSide * BigInt(feeBps)) / BPS;

  const pBase = (fee * BigInt(platformShareBps)) / BPS;
  const cBase = (fee * BigInt(creatorShareBps)) / BPS;
  const rBase = (fee * BigInt(referralShareBps)) / BPS;
  const remainder = fee - pBase - cBase - rBase;

  let platform = pBase + remainder;
  const creator = cBase;
  let referral = rBase;

  if (!referralPresent) {
    platform += rBase;
    referral = 0n;
  }

  return { fee, split: { platform, creator, referral } };
}
