use aiken/collection/list
use aiken/interval.{Finite}
use cardano/transaction.{OutputReference, Transaction}

// ── Creator vesting timelock ──────────────────────────────────────────────────
//
// Locks creator dev allocation tokens until a given POSIX-time threshold,
// with the creator as the only signer that can release them.
//
// Parameters (baked at deployment):
//   creator_pkh    — payment pubkey hash that may withdraw
//   unlock_posix_ms — earliest POSIX time (milliseconds) at which the tokens
//                     may be moved. Cardano wallets express tx validity
//                     ranges in POSIX milliseconds via `validFrom`, so this
//                     matches the off-chain side cleanly.
//
// Datum: not used — the parameters carry all the policy.
// Redeemer: not used — any value is accepted; the on-chain rules below are
//   the only thing that matters.
//
// Rules (all must hold):
//   1. tx is signed by creator_pkh.
//   2. tx.validity_range.lower_bound >= unlock_posix_ms.
//      (the wallet's `validFrom` produces a `Finite` lower bound; absent
//       lower bounds (`NegativeInfinity`) are rejected so the validator
//       can't be cheesed by an open-ended validity window.)

validator vesting(creator_pkh: ByteArray, unlock_posix_ms: Int) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    _utxo: OutputReference,
    tx: Transaction,
  ) {
    let signed_by_creator =
      list.has(tx.extra_signatories, creator_pkh)

    let lower_bound_ok =
      when tx.validity_range.lower_bound.bound_type is {
        Finite(t) -> t >= unlock_posix_ms
        _         -> False
      }

    signed_by_creator && lower_bound_ok
  }

  else(_) {
    fail
  }
}
