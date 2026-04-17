import { describe, it, expect } from 'vitest';
import { generateSeed, deriveAllKeys, encodeAddresses } from '../../src/wallet.js';

describe('wallet (pure pipeline)', () => {
  it('generateSeed → deriveAllKeys → encodeAddresses produces expected shapes', () => {
    const seed = generateSeed();
    expect(seed.length).toBe(32);

    const keys = deriveAllKeys(seed);
    // coinPublicKey is a 32-byte hex string (64 hex chars)
    expect(keys.shielded.keys.coinPublicKey).toMatch(/^[0-9a-f]{64}$/);

    const addresses = encodeAddresses(keys, 'preprod');
    expect(addresses.unshielded).toMatch(/^mn_/);
    expect(addresses.shielded).toMatch(/^mn_/);
    expect(addresses.dust).toMatch(/^mn_/);
  });

  it('different seeds yield different addresses', () => {
    const keys1 = deriveAllKeys(generateSeed());
    const keys2 = deriveAllKeys(generateSeed());
    const a1 = encodeAddresses(keys1, 'preprod');
    const a2 = encodeAddresses(keys2, 'preprod');
    expect(a1.unshielded).not.toBe(a2.unshielded);
    expect(a1.shielded).not.toBe(a2.shielded);
  });
});
