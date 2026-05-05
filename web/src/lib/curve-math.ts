// Mirror of src/cardano/curve.ts — duplicated here so it runs in the browser
// without pulling in Node.js-only dependencies.

export const VIRTUAL_ADA  = 3_000_000_000n;
// Graduation threshold (lovelace). Preprod testing can override via env to a
// smaller value so the curve can actually be filled with test ADA.
const GRAD_ENV = typeof process !== 'undefined'
  ? Number(process.env.NEXT_PUBLIC_GRADUATION_ADA ?? '')
  : NaN;
export const GRADUATION_ADA = Number.isFinite(GRAD_ENV) && GRAD_ENV > 0
  ? BigInt(Math.floor(GRAD_ENV * 1_000_000))
  : 21_000_000_000n; // 21,000 ADA default
export const TOTAL_SUPPLY = 1_000_000_000n;

export function quoteBuy(adaReserve: bigint, tokenReserve: bigint, adaIn: bigint): bigint {
  const effective = adaReserve + VIRTUAL_ADA;
  const k = effective * tokenReserve;
  const newEffective = effective + adaIn;
  const newTokenReserve = k / newEffective;
  return tokenReserve - newTokenReserve;
}

export function quoteSellGross(adaReserve: bigint, tokenReserve: bigint, tokensIn: bigint): bigint {
  const effective = adaReserve + VIRTUAL_ADA;
  const k = effective * tokenReserve;
  const newTokenReserve = tokenReserve + tokensIn;
  const newEffective = k / newTokenReserve;
  const gross = effective - newEffective;
  return gross > adaReserve ? adaReserve : gross;
}

export function spotPrice(adaReserve: bigint, tokenReserve: bigint): bigint {
  const effective = adaReserve + VIRTUAL_ADA;
  if (tokenReserve === 0n) return 0n;
  return (effective * 1_000_000n) / tokenReserve;
}

export function marketCap(adaReserve: bigint, tokenReserve: bigint): bigint {
  const price = spotPrice(adaReserve, tokenReserve);
  return (price * TOTAL_SUPPLY) / 1_000_000n;
}

export function bondedBps(adaReserve: bigint): bigint {
  return (adaReserve * 10000n) / GRADUATION_ADA;
}

export function isGraduated(adaReserve: bigint): boolean {
  return adaReserve >= GRADUATION_ADA;
}
