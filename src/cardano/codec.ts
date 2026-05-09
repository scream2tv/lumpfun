import { Constr, Data } from '@lucid-evolution/lucid';
import type { CurveDatum, CurveRedeemer, OrderDatum, OrderRedeemer, OrderAction } from './types.js';

// ── CurveDatum ────────────────────────────────────────────────────────────────

export function encodeCurveDatum(datum: CurveDatum): string {
  return Data.to(
    new Constr(0, [datum.adaReserve, datum.tokenReserve]),
  );
}

export function decodeCurveDatum(raw: string): CurveDatum {
  const constr = Data.from(raw) as Constr<bigint>;
  if (constr.index !== 0 || constr.fields.length !== 2) {
    throw new Error('Invalid CurveDatum encoding');
  }
  return {
    adaReserve:   constr.fields[0] as bigint,
    tokenReserve: constr.fields[1] as bigint,
  };
}

// ── CurveRedeemer ─────────────────────────────────────────────────────────────

export function encodeCurveRedeemer(r: CurveRedeemer): string {
  switch (r.tag) {
    case 'Buy':      return Data.to(new Constr(0, [r.minOut]));
    case 'Sell':     return Data.to(new Constr(1, [r.minOut]));
    case 'Graduate': return Data.to(new Constr(2, []));
  }
}

// ── OrderAction ───────────────────────────────────────────────────────────────

function encodeOrderAction(a: OrderAction): Constr<never> {
  return a === 'Buy' ? new Constr(0, []) : new Constr(1, []);
}

// ── OrderDatum ────────────────────────────────────────────────────────────────
// Aiken's Option<T> encodes as Constr 0 (None) or Constr 1 (Some, with
// one field). Mirroring that for owner_stake so the batcher can pay back
// to the user's full base address rather than an enterprise address.

function encodeOptionByteArray(v: string | undefined): Constr<Data> {
  return v ? new Constr(1, [v as Data]) : new Constr<Data>(0, []);
}

function decodeOptionByteArray(c: unknown): string | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const o = c as { index?: number; fields?: unknown[] };
  if (o.index === 0) return undefined;
  if (o.index === 1 && o.fields && o.fields.length === 1) return o.fields[0] as string;
  return undefined;
}

export function encodeOrderDatum(d: OrderDatum): string {
  return Data.to(
    new Constr(0, [
      d.ownerPkh,
      encodeOptionByteArray(d.ownerStake),
      d.curvePolicyId,
      d.curveAssetName,
      encodeOrderAction(d.action),
      d.amount,
      d.minOut,
      d.creatorPkh,
      d.treasuryPkh,
    ]),
  );
}

// Tolerates both 9-field (new) and 8-field (legacy) datums so any orders
// at the order_book from before this migration remain decodable.
export function decodeOrderDatum(raw: string): OrderDatum {
  const c = Data.from(raw) as Constr<unknown>;
  if (c.index !== 0) throw new Error('Invalid OrderDatum encoding (constr index)');

  if (c.fields.length === 9) {
    const actionConstr = c.fields[4] as Constr<never>;
    return {
      ownerPkh:        c.fields[0] as string,
      ownerStake:      decodeOptionByteArray(c.fields[1]),
      curvePolicyId:   c.fields[2] as string,
      curveAssetName:  c.fields[3] as string,
      action:          actionConstr.index === 0 ? 'Buy' : 'Sell',
      amount:          c.fields[5] as bigint,
      minOut:          c.fields[6] as bigint,
      creatorPkh:      c.fields[7] as string,
      treasuryPkh:     c.fields[8] as string,
    };
  }
  if (c.fields.length === 8) {
    const actionConstr = c.fields[3] as Constr<never>;
    return {
      ownerPkh:        c.fields[0] as string,
      ownerStake:      undefined,
      curvePolicyId:   c.fields[1] as string,
      curveAssetName:  c.fields[2] as string,
      action:          actionConstr.index === 0 ? 'Buy' : 'Sell',
      amount:          c.fields[4] as bigint,
      minOut:          c.fields[5] as bigint,
      creatorPkh:      c.fields[6] as string,
      treasuryPkh:     c.fields[7] as string,
    };
  }
  throw new Error(`Invalid OrderDatum encoding (field count ${c.fields.length})`);
}

// ── OrderRedeemer ─────────────────────────────────────────────────────────────

export function encodeOrderRedeemer(r: OrderRedeemer): string {
  return r === 'Execute' ? Data.to(new Constr(0, [])) : Data.to(new Constr(1, []));
}

// ── OutputReference (for minting policy param) ────────────────────────────────

// aiken-lang/stdlib v3.x: TransactionId = Hash<Blake2b_256, Transaction> (ByteArray alias, no wrapping Constr)
// Encoding: Constr(0, [ByteArray(txHash), Int(outputIndex)])
export function encodeOutputReference(txHash: string, outputIndex: number): Constr<Data> {
  return new Constr(0, [txHash, BigInt(outputIndex)]);
}
