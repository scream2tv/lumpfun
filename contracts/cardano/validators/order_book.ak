use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}
use lumpfun/types.{Cancel, Execute, OrderDatum, OrderRedeemer}

// ── Order book validator ──────────────────────────────────────────────────────
//
// Shared across all tokens. Solves Cardano's eUTxO concurrency problem:
// users submit orders as independent UTxOs here rather than racing to spend
// the single curve UTxO. An off-chain batcher processes pending orders
// sequentially against each curve.
//
// Cancel: order owner reclaims funds at any time.
// Execute: permissionless — any batcher may process the order. The bonding
//          curve validator independently enforces all math and fee invariants.

validator order_book {
  spend(
    datum: Option<OrderDatum>,
    redeemer: OrderRedeemer,
    _utxo: OutputReference,
    tx: Transaction,
  ) {
    expect Some(order) = datum

    when redeemer is {
      Execute -> True
      Cancel -> validate_cancel(order, tx)
    }
  }

  else(_) {
    fail
  }
}

fn validate_cancel(order: OrderDatum, tx: Transaction) -> Bool {
  // Only the original submitter may cancel their pending order.
  list.any(tx.extra_signatories, fn(sig) { sig == order.owner_pkh })
}
