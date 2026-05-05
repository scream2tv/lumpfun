use lumpfun/math.{
  graduation_ada, is_graduated, quote_buy, quote_sell_gross, total_supply,
  virtual_ada,
}

// ── quote_buy ─────────────────────────────────────────────────────────────────

test buy_zero_returns_zero() {
  quote_buy(0, total_supply, 0) == 0
}

test buy_1000_ada_from_initial_gives_250m_tokens() {
  // effective = 3000 ADA, new_effective = 4000 ADA
  // new_token_reserve = floor(3000 * 1B / 4000) = 750M
  // tokens_out = 1B - 750M = 250M
  let ada_1000 = 1_000_000_000
  quote_buy(0, total_supply, ada_1000) == 250_000_000
}

test buy_virtual_ada_amount_halves_supply() {
  // Buying exactly VIRTUAL_ADA (3000 ADA) doubles the effective reserve.
  // new_effective = 2 * virtual_ada, new_token_reserve = virtual_ada * 1B / (2 * virtual_ada) = 500M
  quote_buy(0, total_supply, virtual_ada) == 500_000_000
}

test buy_price_increases_with_each_buy() {
  // After buying 1000 ADA, the next 1000 ADA should yield fewer tokens.
  let ada_1000 = 1_000_000_000
  let tokens_first = quote_buy(0, total_supply, ada_1000)
  // State after first buy: ada_reserve=1000 ADA, token_reserve = total_supply - tokens_first
  let ada_after = ada_1000
  let tokens_after = total_supply - tokens_first
  let tokens_second = quote_buy(ada_after, tokens_after, ada_1000)
  // Second buy yields fewer tokens due to higher price
  tokens_second < tokens_first
}

test buy_tokens_cannot_exceed_reserve() {
  // Buying a very large amount cannot exceed the token reserve
  let huge_ada = 1_000_000_000_000
  // tokens_out must be < total_supply
  quote_buy(0, total_supply, huge_ada) < total_supply
}

// ── quote_sell_gross ──────────────────────────────────────────────────────────

test sell_zero_returns_zero() {
  // State after a 1000 ADA buy
  let ada_reserve = 1_000_000_000
  let token_reserve = total_supply - 250_000_000
  quote_sell_gross(ada_reserve, token_reserve, 0) == 0
}

test sell_round_trip_recovers_ada() {
  // Buy 1000 ADA worth of tokens then sell them all back.
  // Should recover approximately 1000 ADA (within 1 lovelace rounding).
  let ada_in = 1_000_000_000
  let tokens_out = quote_buy(0, total_supply, ada_in)
  let token_reserve_after = total_supply - tokens_out
  let ada_gross = quote_sell_gross(ada_in, token_reserve_after, tokens_out)
  // Allow ±1 lovelace for integer rounding
  let diff =
    if ada_gross > ada_in {
      ada_gross - ada_in
    } else {
      ada_in - ada_gross
    }
  diff <= 1
}

test sell_gross_capped_at_ada_reserve() {
  // quote_sell_gross must never exceed ada_reserve regardless of token amount
  let ada_reserve = 1_000_000_000
  let token_reserve = 750_000_000
  // Selling an enormous number of tokens should still cap at ada_reserve
  let gross = quote_sell_gross(ada_reserve, token_reserve, 10_000_000_000)
  gross <= ada_reserve
}

test sell_gross_positive_for_nonzero_tokens() {
  let ada_reserve = 5_000_000_000
  let token_reserve = 600_000_000
  quote_sell_gross(ada_reserve, token_reserve, 100_000_000) > 0
}

// ── is_graduated ─────────────────────────────────────────────────────────────

test not_graduated_below_threshold() {
  !is_graduated(graduation_ada - 1)
}

test graduated_at_exact_threshold() {
  is_graduated(graduation_ada)
}

test graduated_above_threshold() {
  is_graduated(graduation_ada + 1_000_000_000)
}

test initial_state_not_graduated() {
  !is_graduated(0)
}

// ── curve invariants ──────────────────────────────────────────────────────────

test buy_then_sell_state_returns_to_start() {
  // After a buy and a complete sell-back, reserves should return to approximately
  // the original values (within 1 lovelace rounding).
  let ada_in = 2_000_000_000
  let tokens_out = quote_buy(0, total_supply, ada_in)
  let ada_reserve_after = ada_in
  let token_reserve_after = total_supply - tokens_out
  let ada_gross = quote_sell_gross(ada_reserve_after, token_reserve_after, tokens_out)
  // Net ada_reserve after sell should be ada_reserve_after - ada_gross ≈ 0
  let residual = ada_reserve_after - ada_gross
  residual >= 0 && residual <= 1
}

test larger_buy_yields_larger_ada_gross_on_sell() {
  // More tokens bought → bigger sell gross when selling the same fraction back.
  // Buy A tokens vs buy B > A tokens; selling A tokens from state B should yield more.
  let small_buy = 500_000_000
  let large_buy = 2_000_000_000

  let tokens_small = quote_buy(0, total_supply, small_buy)
  let tokens_large = quote_buy(0, total_supply, large_buy)

  // Sell the small-buy token amount from each state
  let gross_from_small_state =
    quote_sell_gross(small_buy, total_supply - tokens_small, tokens_small)
  let gross_from_large_state =
    quote_sell_gross(large_buy, total_supply - tokens_large, tokens_small)

  // Higher ada_reserve means higher sell gross for the same token amount
  gross_from_large_state > gross_from_small_state
}
