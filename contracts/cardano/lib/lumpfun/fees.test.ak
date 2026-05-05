use lumpfun/fees.{ada_net, creator_fee, creator_fee_paid, platform_fee}

// ── creator_fee ───────────────────────────────────────────────────────────────

test creator_fee_zero_bps_is_zero() {
  creator_fee(10_000_000, 0) == 0
}

test creator_fee_100_bps_on_10_ada() {
  // 1% of 10 ADA (10_000_000 lovelace) = 100_000 lovelace = 0.1 ADA
  creator_fee(10_000_000, 100) == 100_000
}

test creator_fee_200_bps_on_10_ada() {
  // 2% of 10 ADA = 200_000 lovelace = 0.2 ADA
  creator_fee(10_000_000, 200) == 200_000
}

test creator_fee_scales_with_gross() {
  // Fee should be proportional: doubling gross doubles fee
  let fee_10 = creator_fee(10_000_000, 100)
  let fee_20 = creator_fee(20_000_000, 100)
  fee_20 == fee_10 * 2
}

test creator_fee_floors_on_small_gross() {
  // 1% of 999 lovelace = floor(9.99) = 9
  creator_fee(999, 100) == 9
}

// ── creator_fee on buy-side ada_in ────────────────────────────────────────────
//
// validate_buy applies the same creator_fee function to ada_in (the lovelace
// added to the curve), so the math is identical to the sell-side cases above.
// These tests pin the buy-side semantics explicitly.

test creator_fee_buy_100_bps_on_50_ada_in() {
  creator_fee(50_000_000, 100) == 500_000
}

test creator_fee_buy_200_bps_on_25_ada_in() {
  creator_fee(25_000_000, 200) == 500_000
}

test creator_fee_buy_zero_bps_is_zero() {
  creator_fee(50_000_000, 0) == 0
}

// ── creator_fee_paid edge case ────────────────────────────────────────────────

test creator_fee_paid_skips_check_when_bps_zero() {
  // bps=0 ⇒ fee=0 ⇒ no creator output required, regardless of pkh / outputs.
  creator_fee_paid([], #"deadbeef", 50_000_000, 0)
}

// ── ada_net ───────────────────────────────────────────────────────────────────

test ada_net_at_1pct_on_10_ada() {
  // 10 ADA gross - 0.1 ADA creator fee - 1 ADA platform fee = 8.9 ADA
  ada_net(10_000_000, 100) == 8_900_000
}

test ada_net_at_0_bps_only_deducts_platform_fee() {
  // 5 ADA - 0 creator - 1 ADA platform = 4 ADA
  ada_net(5_000_000, 0) == 4_000_000
}

test ada_net_at_2pct_on_10_ada() {
  // 10 ADA - 0.2 ADA creator - 1 ADA platform = 8.8 ADA
  ada_net(10_000_000, 200) == 8_800_000
}

test platform_fee_constant_is_1_ada() {
  platform_fee == 1_000_000
}

test creator_plus_platform_plus_net_equals_gross() {
  // Conservation: all parts sum to gross
  let gross = 50_000_000
  let bps = 100
  let c_fee = creator_fee(gross, bps)
  let net = ada_net(gross, bps)
  c_fee + platform_fee + net == gross
}

test conservation_holds_for_various_inputs() {
  // Spot-check conservation at multiple values
  let check =
    fn(gross, bps) {
      creator_fee(gross, bps) + platform_fee + ada_net(gross, bps) == gross
    }
  check(10_000_000, 100) && check(100_000_000, 100) && check(50_000_000, 200) && check(
    5_000_000,
    0,
  )
}
