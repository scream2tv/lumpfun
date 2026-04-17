export function curveCostBuy(
  from: bigint,
  delta: bigint,
  basePrice: bigint,
  slope: bigint,
): bigint {
  if (delta === 0n) return 0n;
  return basePrice * delta + slope * (from * delta + (delta * (delta - 1n)) / 2n);
}

export function curvePayoutSell(
  tokensSoldBefore: bigint,
  delta: bigint,
  basePrice: bigint,
  slope: bigint,
): bigint {
  // curve_payout for selling `delta` tokens when supply is `tokensSoldBefore`:
  //   integral from (tokensSoldBefore - delta) to tokensSoldBefore
  //   = curveCostBuy(tokensSoldBefore - delta, delta)
  // Caller passes `tokensSoldBefore` (usually `launch.state.tokensSold`);
  // the subtraction happens inside so call sites read naturally.
  if (delta === 0n) return 0n;
  if (tokensSoldBefore < delta) {
    throw new Error(
      `curvePayoutSell: tokensSoldBefore (${tokensSoldBefore}) < delta (${delta})`,
    );
  }
  return curveCostBuy(tokensSoldBefore - delta, delta, basePrice, slope);
}

export function currentPrice(
  tokensSold: bigint,
  basePrice: bigint,
  slope: bigint,
): bigint {
  // Marginal price of the *next* token.
  return basePrice + slope * tokensSold;
}
