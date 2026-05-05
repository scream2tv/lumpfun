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

export function encodeOrderDatum(d: OrderDatum): string {
  return Data.to(
    new Constr(0, [
      d.ownerPkh,
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

export function decodeOrderDatum(raw: string): OrderDatum {
  const c = Data.from(raw) as Constr<unknown>;
  if (c.index !== 0 || c.fields.length !== 8) {
    throw new Error('Invalid OrderDatum encoding');
  }
  const actionConstr = c.fields[3] as Constr<never>;
  const action: OrderAction = actionConstr.index === 0 ? 'Buy' : 'Sell';
  return {
    ownerPkh:        c.fields[0] as string,
    curvePolicyId:   c.fields[1] as string,
    curveAssetName:  c.fields[2] as string,
    action,
    amount:          c.fields[4] as bigint,
    minOut:          c.fields[5] as bigint,
    creatorPkh:      c.fields[6] as string,
    treasuryPkh:     c.fields[7] as string,
  };
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
