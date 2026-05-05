// ── On-chain datum & redeemer types ──────────────────────────────────────────

/// Inline datum stored on every bonding curve UTxO.
pub type CurveDatum {
  ada_reserve: Int,
  token_reserve: Int,
}

/// Redeemer for the bonding curve validator.
pub type CurveRedeemer {
  /// Buy tokens. min_out: minimum tokens the buyer accepts (slippage guard).
  Buy { min_out: Int }
  /// Sell tokens. min_out: minimum net ADA the seller accepts (slippage guard).
  Sell { min_out: Int }
  /// Migrate liquidity to Minswap once ada_reserve >= GRADUATION_ADA.
  Graduate
}

// ── Order book (batcher concurrency) ─────────────────────────────────────────

pub type OrderAction {
  OrderBuy
  OrderSell
}

/// Datum locked in the order book contract while a user's order is pending.
pub type OrderDatum {
  owner_pkh: ByteArray,
  curve_policy_id: ByteArray,
  curve_asset_name: ByteArray,
  action: OrderAction,
  amount: Int,
  min_out: Int,
  creator_pkh: ByteArray,
  treasury_pkh: ByteArray,
}

/// Order book redeemer.
pub type OrderRedeemer {
  /// Batcher executes the pending order against the curve.
  Execute
  /// Owner cancels their own pending order and reclaims funds.
  Cancel
}
