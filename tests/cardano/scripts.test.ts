import { describe, it, expect } from 'vitest';
import {
  BONDING_CURVE_CBOR,
  MINTING_POLICY_CBOR,
  ORDER_BOOK_CBOR,
  SCRIPT_HASHES,
  REDEEMER_BUY, REDEEMER_SELL, REDEEMER_GRADUATE,
  ORDER_EXECUTE, ORDER_CANCEL,
  ORDER_ACTION_BUY, ORDER_ACTION_SELL,
} from '../../src/cardano/scripts.js';

describe('scripts — CBOR constants', () => {
  it('bonding curve CBOR is a valid hex string starting with 59 (byte-string prefix)', () => {
    expect(BONDING_CURVE_CBOR).toMatch(/^[0-9a-f]+$/);
    expect(BONDING_CURVE_CBOR.startsWith('59')).toBe(true);
    // Length must be even (whole bytes)
    expect(BONDING_CURVE_CBOR.length % 2).toBe(0);
    // Must be non-trivially long (our validator is ~1500 bytes)
    expect(BONDING_CURVE_CBOR.length).toBeGreaterThan(2000);
  });

  it('minting policy CBOR is a valid hex string', () => {
    expect(MINTING_POLICY_CBOR).toMatch(/^[0-9a-f]+$/);
    expect(MINTING_POLICY_CBOR.length % 2).toBe(0);
    expect(MINTING_POLICY_CBOR.length).toBeGreaterThan(100);
  });

  it('order book CBOR is a valid hex string', () => {
    expect(ORDER_BOOK_CBOR).toMatch(/^[0-9a-f]+$/);
    expect(ORDER_BOOK_CBOR.length % 2).toBe(0);
    expect(ORDER_BOOK_CBOR.length).toBeGreaterThan(200);
  });
});

describe('scripts — script hashes', () => {
  it('all hashes are 28-byte hex strings (56 hex chars = 224 bits = Blake2b-224)', () => {
    for (const [name, hash] of Object.entries(SCRIPT_HASHES)) {
      expect(hash).toMatch(/^[0-9a-f]{56}$/, `${name} hash should be 56 hex chars`);
    }
  });

  it('all three hashes are distinct', () => {
    const hashes = Object.values(SCRIPT_HASHES);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe('scripts — redeemer tags', () => {
  it('Buy / Sell / Graduate are sequential starting from 0', () => {
    expect(REDEEMER_BUY).toBe(0);
    expect(REDEEMER_SELL).toBe(1);
    expect(REDEEMER_GRADUATE).toBe(2);
  });

  it('order Execute / Cancel are sequential starting from 0', () => {
    expect(ORDER_EXECUTE).toBe(0);
    expect(ORDER_CANCEL).toBe(1);
  });

  it('order action Buy / Sell are sequential starting from 0', () => {
    expect(ORDER_ACTION_BUY).toBe(0);
    expect(ORDER_ACTION_SELL).toBe(1);
  });
});
