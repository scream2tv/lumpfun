use aiken/collection/list
use cardano/assets.{lovelace_of, quantity_of}
use cardano/transaction.{InlineDatum, Input, Output, OutputReference, Transaction}
use lumpfun/fees.{creator_fee_paid, platform_fee_paid}
use lumpfun/math.{quote_buy, quote_sell_gross}
use lumpfun/types.{Buy, CurveDatum, CurveRedeemer, Graduate, Sell}

// ── Bonding curve validator ───────────────────────────────────────────────────
//
// Parameterised at deployment time with token identity and protocol addresses.
//
// State: each curve UTxO carries a CurveDatum inline datum with:
//   ada_reserve   — total ADA from trades locked in this UTxO (lovelace)
//   token_reserve — tokens available for purchase in this UTxO
//
// The UTxO's actual lovelace equals ada_reserve (the "deposit" min-UTxO is
// folded into ada_reserve so the off-chain code seeds it at launch).
//
// Redeemers:
//   Buy  { min_out } — buy tokens; min_out = slippage floor for tokens received
//   Sell { min_out } — sell tokens; min_out = slippage floor for net ADA
//   Graduate         — drain curve into a Minswap pool (one-way, irreversible)

validator bonding_curve(
  policy_id: ByteArray,
  asset_name: ByteArray,
  creator_fee_bps: Int,
  treasury_pkh: ByteArray,
  creator_pkh: ByteArray,
  graduation_ada: Int,
) {
  spend(
    datum: Option<CurveDatum>,
    redeemer: CurveRedeemer,
    utxo: OutputReference,
    tx: Transaction,
  ) {
    expect Some(d) = datum

    // Resolve our own input so we can read the actual UTxO value and address.
    expect Some(own_input) =
      list.find(tx.inputs, fn(i) { i.output_reference == utxo })

    when redeemer is {
      Buy { min_out } ->
        validate_buy(
          d,
          min_out,
          own_input,
          policy_id,
          asset_name,
          creator_fee_bps,
          treasury_pkh,
          creator_pkh,
          graduation_ada,
          tx,
        )
      Sell { min_out } ->
        validate_sell(
          d,
          min_out,
          own_input,
          policy_id,
          asset_name,
          creator_fee_bps,
          treasury_pkh,
          creator_pkh,
          graduation_ada,
          tx,
        )
      Graduate ->
        validate_graduate(d, graduation_ada)
    }
  }

  else(_) {
    fail
  }
}

// ── Buy ───────────────────────────────────────────────────────────────────────

fn validate_buy(
  datum: CurveDatum,
  min_out: Int,
  own_input: Input,
  policy_id: ByteArray,
  asset_name: ByteArray,
  creator_fee_bps: Int,
  treasury_pkh: ByteArray,
  creator_pkh: ByteArray,
  graduation_ada: Int,
  tx: Transaction,
) -> Bool {
  let own_address = own_input.output.address

  // There must be exactly one continuation output at the curve address.
  expect [own_output] =
    list.filter(tx.outputs, fn(o) { o.address == own_address })

  // Decode the updated datum from the continuation output.
  expect InlineDatum(raw) = own_output.datum
  expect new_d: CurveDatum = raw

  let old_ada = datum.ada_reserve
  let old_tokens = datum.token_reserve
  let new_ada = new_d.ada_reserve
  let new_tokens = new_d.token_reserve

  // Derived values from the datum transition.
  let ada_in = new_ada - old_ada
  let tokens_out = old_tokens - new_tokens

  // Cannot trade on a graduated curve.
  let not_graduated = old_ada < graduation_ada

  // ada_in must be strictly positive.
  let ada_in_positive = ada_in > 0

  // tokens_out must match the constant-product formula precisely.
  let correct_tokens_out = tokens_out == quote_buy(old_ada, old_tokens, ada_in)

  // Slippage protection: buyer declared minimum acceptable output.
  let slippage_ok = tokens_out >= min_out

  // UTxO value must be consistent with the datum transition.
  // ADA: increased by exactly ada_in.
  let curve_ada_ok =
    lovelace_of(own_output.value) == lovelace_of(own_input.output.value) + ada_in

  // Tokens: decreased by exactly tokens_out.
  let curve_tokens_ok =
    quantity_of(own_output.value, policy_id, asset_name) == quantity_of(
      own_input.output.value,
      policy_id,
      asset_name,
    ) - tokens_out

  // Platform fee (1 ADA) must appear in the outputs to treasury.
  let platform_ok = platform_fee_paid(tx.outputs, treasury_pkh)

  // Creator rev-share on buy gross. Same shape as sell, but applied to
  // ada_in (the lovelace that increases ada_reserve) rather than ada_gross.
  let creator_ok =
    creator_fee_paid(tx.outputs, creator_pkh, ada_in, creator_fee_bps)

  not_graduated && ada_in_positive && correct_tokens_out && slippage_ok && curve_ada_ok && curve_tokens_ok && platform_ok && creator_ok
}

// ── Sell ──────────────────────────────────────────────────────────────────────

fn validate_sell(
  datum: CurveDatum,
  min_out: Int,
  own_input: Input,
  policy_id: ByteArray,
  asset_name: ByteArray,
  creator_fee_bps: Int,
  treasury_pkh: ByteArray,
  creator_pkh: ByteArray,
  graduation_ada: Int,
  tx: Transaction,
) -> Bool {
  let own_address = own_input.output.address

  expect [own_output] =
    list.filter(tx.outputs, fn(o) { o.address == own_address })

  expect InlineDatum(raw) = own_output.datum
  expect new_d: CurveDatum = raw

  let old_ada = datum.ada_reserve
  let old_tokens = datum.token_reserve
  let new_ada = new_d.ada_reserve
  let new_tokens = new_d.token_reserve

  let tokens_in = new_tokens - old_tokens
  let ada_gross = old_ada - new_ada

  let not_graduated = old_ada < graduation_ada
  let tokens_in_positive = tokens_in > 0

  // ada_gross must match the constant-product formula.
  let correct_gross = ada_gross == quote_sell_gross(old_ada, old_tokens, tokens_in)

  // Net ADA after all fees — seller declared minimum acceptable amount.
  let net_ada = ada_gross - ada_gross * creator_fee_bps / 10_000 - 1_000_000
  let slippage_ok = net_ada >= min_out

  // UTxO value consistency.
  let curve_ada_ok =
    lovelace_of(own_output.value) == lovelace_of(own_input.output.value) - ada_gross

  let curve_tokens_ok =
    quantity_of(own_output.value, policy_id, asset_name) == quantity_of(
      own_input.output.value,
      policy_id,
      asset_name,
    ) + tokens_in

  // Both fee outputs must be present.
  let platform_ok = platform_fee_paid(tx.outputs, treasury_pkh)
  let creator_ok =
    creator_fee_paid(tx.outputs, creator_pkh, ada_gross, creator_fee_bps)

  not_graduated && tokens_in_positive && correct_gross && slippage_ok && curve_ada_ok && curve_tokens_ok && platform_ok && creator_ok
}

// ── Graduate ──────────────────────────────────────────────────────────────────

fn validate_graduate(datum: CurveDatum, graduation_ada: Int) -> Bool {
  // Threshold must be met. The Minswap pool-creation outputs are constructed
  // by the off-chain tx builder using computeGraduationQuote; the curve validator
  // does not re-check the pool structure here (the pool validator enforces its own
  // invariants). A treasury co-signature is required at the application layer.
  datum.ada_reserve >= graduation_ada
}
