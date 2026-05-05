use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}

/// One-shot minting policy — guarantees a unique policy ID per token.
///
/// `one_shot_utxo` must be consumed in the minting transaction. Because a UTxO
/// can only be spent once, the policy ID derived from this parameterized
/// validator is globally unique and cannot be re-used to mint additional tokens.
///
/// The token name and total supply are enforced by the bonding curve validator
/// rather than here, keeping this policy minimal and easy to audit.
validator lump_mint(one_shot_utxo: OutputReference) {
  mint(_redeemer: Data, _policy_id: ByteArray, tx: Transaction) {
    // Uniqueness: the specified UTxO must be consumed in this transaction.
    list.any(tx.inputs, fn(i) { i.output_reference == one_shot_utxo })
  }

  else(_) {
    fail
  }
}
