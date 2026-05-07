use aiken/collection/list
use cardano/address.{Credential}
use cardano/assets.{lovelace_of}
use cardano/transaction.{Output}

/// 1 ADA flat fee per trade → protocol owner (treasury).
pub const platform_fee: Int = 1_000_000

/// Creator rev-share on sell gross in basis points (100 = 1%, max 200 = 2%).
pub fn creator_fee(ada_gross: Int, creator_fee_bps: Int) -> Int {
  ada_gross * creator_fee_bps / 10_000
}

/// Net ADA a seller receives after deducting creator rev-share and platform fee.
pub fn ada_net(ada_gross: Int, creator_fee_bps: Int) -> Int {
  ada_gross - creator_fee(ada_gross, creator_fee_bps) - platform_fee
}

/// Returns true when at least one tx output pays `min_lovelace` to an
/// address whose payment credential — either VerificationKey *or* Script —
/// matches `hash`. Accepting both lets the bonding-curve validator route
/// creator fees to a per-launch accumulator script (parameterised with
/// the creator's vkey) instead of the creator's wallet directly.
pub fn output_pays_pkh_at_least(
  outputs: List<Output>,
  pkh: ByteArray,
  min_lovelace: Int,
) -> Bool {
  list.any(
    outputs,
    fn(o) {
      when o.address.payment_credential is {
        Credential.VerificationKey(h) ->
          h == pkh && lovelace_of(o.value) >= min_lovelace
        Credential.Script(h) ->
          h == pkh && lovelace_of(o.value) >= min_lovelace
      }
    },
  )
}

pub fn platform_fee_paid(outputs: List<Output>, treasury_pkh: ByteArray) -> Bool {
  output_pays_pkh_at_least(outputs, treasury_pkh, platform_fee)
}

pub fn creator_fee_paid(
  outputs: List<Output>,
  creator_pkh: ByteArray,
  ada_gross: Int,
  creator_fee_bps: Int,
) -> Bool {
  let fee = creator_fee(ada_gross, creator_fee_bps)
  fee == 0 || output_pays_pkh_at_least(outputs, creator_pkh, fee)
}
