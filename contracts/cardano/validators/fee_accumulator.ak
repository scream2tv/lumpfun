use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}

// ── Per-launch creator fee accumulator ───────────────────────────────────────
//
// Trades on the bonding curve pay the creator's revenue share to this
// script address instead of the creator's wallet directly. Fees pile up
// at one (or a few) UTxOs at this address; the creator sweeps periodically
// with a single tx.
//
// Why: each direct creator-fee payment is a sub-1-ADA output that Cardano
// bumps to min-UTxO, fragmenting the wallet across hundreds of dust UTxOs
// after a few hundred trades. Accumulating into a single growing UTxO
// keeps the creator's wallet clean and lets them claim a real lump sum.
//
// Parameters (baked at deployment):
//   creator_pkh — only key that can spend from this address.
//
// Datum / redeemer: unused. The single rule is "tx is signed by creator".

validator fee_accumulator(creator_pkh: ByteArray) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _utxo: OutputReference,
    tx: Transaction,
  ) {
    list.has(tx.extra_signatories, creator_pkh)
  }

  else(_) {
    fail
  }
}
