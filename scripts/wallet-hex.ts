/**
 * Print the server wallet's unshielded address as 32-byte hex.
 *
 * The CLI's `launch deploy --platform-recipient <hex>` flag expects the raw
 * Bytes<32> address payload, not the bech32m form. This helper derives it
 * from the seed at ~/.lumpfun/seed.hex.
 */

import 'dotenv/config';
import { loadSeed, deriveAllKeys } from '../src/wallet.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';

const seed = loadSeed();
const keys = deriveAllKeys(seed);
seed.fill(0);

const verifyingKey = ledger.signatureVerifyingKey(keys.unshielded.toString('hex'));
const addrHex = ledger.addressFromKey(verifyingKey);

console.log(addrHex);
