import { describe, it, expect } from 'vitest';
import {
  encodeCurveDatum,
  decodeCurveDatum,
  encodeCurveRedeemer,
  encodeOrderDatum,
  decodeOrderDatum,
  encodeOrderRedeemer,
  encodeOutputReference,
} from '../../src/cardano/codec.js';

describe('codec — CurveDatum round-trip', () => {
  it('encodes and decodes symmetric datum', () => {
    const orig = { adaReserve: 5_000_000n, tokenReserve: 800_000_000n };
    const hex = encodeCurveDatum(orig);
    expect(hex).toMatch(/^[0-9a-f]+$/);
    const decoded = decodeCurveDatum(hex);
    expect(decoded.adaReserve).toBe(orig.adaReserve);
    expect(decoded.tokenReserve).toBe(orig.tokenReserve);
  });

  it('encodes zero state correctly', () => {
    const zero = { adaReserve: 0n, tokenReserve: 1_000_000_000n };
    expect(decodeCurveDatum(encodeCurveDatum(zero))).toEqual(zero);
  });
});

describe('codec — CurveRedeemer', () => {
  it('encodes Buy with minOut', () => {
    const hex = encodeCurveRedeemer({ tag: 'Buy', minOut: 12345n });
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it('encodes Sell with minOut', () => {
    const hex = encodeCurveRedeemer({ tag: 'Sell', minOut: 999n });
    expect(hex).toMatch(/^[0-9a-f]+$/);
    // Sell constructor index 1 — should differ from Buy (index 0)
    const buyHex = encodeCurveRedeemer({ tag: 'Buy', minOut: 999n });
    expect(hex).not.toBe(buyHex);
  });

  it('encodes Graduate with no fields', () => {
    const hex = encodeCurveRedeemer({ tag: 'Graduate' });
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });
});

describe('codec — OrderDatum round-trip', () => {
  const sample = {
    ownerPkh:       'aabbccddeeff00112233445566778899aabbccddeeff001122334455',
    curvePolicyId:  '6780d00c60ca54dd5df9a5b55cbceeb815006d03ac7f268cf43a501a',
    curveAssetName: '4d544b',
    action: 'Buy' as const,
    amount:  50_000_000n,
    minOut:  1_000n,
    creatorPkh:  'aabbccddeeff00112233445566778899aabbccddeeff001122334456',
    treasuryPkh: 'aabbccddeeff00112233445566778899aabbccddeeff001122334457',
  };

  it('encodes and decodes Buy order', () => {
    const hex = encodeOrderDatum(sample);
    const decoded = decodeOrderDatum(hex);
    expect(decoded.ownerPkh).toBe(sample.ownerPkh);
    expect(decoded.action).toBe('Buy');
    expect(decoded.amount).toBe(sample.amount);
    expect(decoded.minOut).toBe(sample.minOut);
  });

  it('encodes and decodes Sell order', () => {
    const sell = { ...sample, action: 'Sell' as const, amount: 5_000n };
    const decoded = decodeOrderDatum(encodeOrderDatum(sell));
    expect(decoded.action).toBe('Sell');
    expect(decoded.amount).toBe(5_000n);
  });
});

describe('codec — OrderRedeemer', () => {
  it('Execute and Cancel produce distinct hex strings', () => {
    const exec   = encodeOrderRedeemer('Execute');
    const cancel = encodeOrderRedeemer('Cancel');
    expect(exec).toMatch(/^[0-9a-f]+$/);
    expect(cancel).toMatch(/^[0-9a-f]+$/);
    expect(exec).not.toBe(cancel);
  });
});

describe('codec — OutputReference', () => {
  it('encodes a UTxO reference as a Constr<Data>', () => {
    const ref = encodeOutputReference(
      'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      0,
    );
    expect(ref.index).toBe(0);
    expect(ref.fields).toHaveLength(2);
  });

  it('different output indexes produce different encoding', () => {
    const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const r0 = encodeOutputReference(hash, 0);
    const r1 = encodeOutputReference(hash, 1);
    // The second field (outputIndex as BigInt) should differ
    expect(r0.fields[1]).toBe(0n);
    expect(r1.fields[1]).toBe(1n);
  });
});
