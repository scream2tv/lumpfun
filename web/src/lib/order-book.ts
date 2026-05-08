// Order book validator — shared across all tokens, unparameterised.
//
// Mirrors the CBOR in src/cardano/scripts.ts. Kept duplicated here so the
// browser bundle never touches the CLI's Node-only imports. Regenerate by
// running `cd contracts/cardano && aiken build` and copying ORDER_BOOK_CBOR.

import { applyDoubleCborEncoding, validatorToAddress } from '@lucid-evolution/lucid';

export const ORDER_BOOK_CBOR =
  '59010601010029800aba2aba1aab9faab9eaab9dab9a48888896600264653001300700198039804000cc01c0092225980099b8748008c01cdd500144c8cc8a60022b30013001300a375400513259800980118059baa0078a51899198008009bac300f30103010301030103010301030103010300d375400c44b30010018a508acc004cdc79bae3010001375c6020601c6ea800e29462660040046022002806100f2014300d300b3754005164025300a375400d300d003488966002600800515980098071baa009801c5900f456600266e1d20020028acc004c038dd5004c00e2c807a2c806100c0c02cc030004dc3a400060106ea800a2c8030600e00260066ea801e29344d9590011';

export const ORDER_BOOK_VALIDATOR = {
  type:   'PlutusV3' as const,
  script: applyDoubleCborEncoding(ORDER_BOOK_CBOR),
};

// Returns the bech32 address where order UTxOs are locked. Network-aware so
// preprod / mainnet stay separated even when both use the same script CBOR.
export function getOrderBookAddress(network: 'Mainnet' | 'Preprod'): string {
  return validatorToAddress(network, ORDER_BOOK_VALIDATOR);
}
