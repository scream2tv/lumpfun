// Bonding curve math — mirrors src/cardano/curve.ts exactly so off-chain quotes
// and on-chain validation use the same integer arithmetic.

/// 3,000 ADA virtual offset (in lovelace). Sets the starting price without
/// requiring any real liquidity to be seeded at launch.
pub const virtual_ada: Int = 3_000_000_000

/// 21,000 ADA in lovelace — real ada_reserve threshold for DEX graduation.
pub const graduation_ada: Int = 21_000_000_000

/// 1 billion tokens with 0 decimals.
pub const total_supply: Int = 1_000_000_000

/// How many tokens a buyer receives for `ada_in` lovelace.
/// Floor division means buyers get slightly fewer tokens — keeps k non-decreasing.
pub fn quote_buy(ada_reserve: Int, token_reserve: Int, ada_in: Int) -> Int {
  let effective = ada_reserve + virtual_ada
  let k = effective * token_reserve
  let new_effective = effective + ada_in
  let new_token_reserve = k / new_effective
  token_reserve - new_token_reserve
}

/// Gross ADA a seller receives for `tokens_in` before fees are deducted.
/// Capped at ada_reserve as a safety bound against rounding edge cases.
pub fn quote_sell_gross(ada_reserve: Int, token_reserve: Int, tokens_in: Int) -> Int {
  let effective = ada_reserve + virtual_ada
  let k = effective * token_reserve
  let new_token_reserve = token_reserve + tokens_in
  let new_effective = k / new_token_reserve
  let gross = effective - new_effective
  if gross > ada_reserve {
    ada_reserve
  } else {
    gross
  }
}

/// True once real ada_reserve reaches the graduation threshold.
pub fn is_graduated(ada_reserve: Int) -> Bool {
  ada_reserve >= graduation_ada
}
