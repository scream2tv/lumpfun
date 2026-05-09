// Plutus Data encoders / decoders for OrderDatum + redeemers. Mirror of
// src/cardano/codec.ts kept web-local so the browser bundle stays
// independent of the CLI codepath.

import { Constr, Data } from '@lucid-evolution/lucid';

export type OrderAction = 'Buy' | 'Sell';

export interface OrderDatum {
  ownerPkh:       string;            // hex (payment-key hash)
  ownerStake?:    string;            // hex (stake-key hash). Carries the seller's stake credential
                                     // through the order_book so the batcher can pay trade outputs
                                     // back to the user's full base address instead of an enterprise
                                     // address derived from ownerPkh alone. Undefined when the user
                                     // is on an enterprise-only wallet.
  curvePolicyId:  string;            // hex
  curveAssetName: string;            // hex (asset name, NOT prefixed with policy)
  action:         OrderAction;
  amount:         bigint;            // lovelace (Buy) or token units (Sell)
  minOut:         bigint;            // slippage floor — same field used by curve validator
  creatorPkh:     string;            // hex
  treasuryPkh:    string;            // hex
}

export type OrderRedeemer = 'Execute' | 'Cancel';

function encodeOrderAction(a: OrderAction): Constr<never> {
  return a === 'Buy' ? new Constr(0, []) : new Constr(1, []);
}

// Aiken's Option<T> encodes as Constr 0 (None) with no fields, or Constr 1
// (Some) with a single field. Mirroring that here for owner_stake.
import type { Data as PlutusData } from '@lucid-evolution/lucid';
function encodeOptionByteArray(v: string | undefined): Constr<PlutusData> {
  return v ? new Constr(1, [v as PlutusData]) : new Constr<PlutusData>(0, []);
}

function decodeOptionByteArray(c: unknown): string | undefined {
  if (!c || typeof c !== 'object') return undefined;
  const o = c as { index?: number; fields?: unknown[] };
  if (o.index === 0) return undefined;                        // None
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

// Tolerates both the new 9-field schema and any legacy 8-field datums
// still locked at the order_book from before this migration. Old orders
// remain cancellable by their owners; the batcher just won't have a stake
// credential to pay back to (falls through to enterprise as before).
export function decodeOrderDatum(raw: string): OrderDatum {
  const c = Data.from(raw) as Constr<unknown>;
  if (c.index !== 0) throw new Error('Invalid OrderDatum encoding (constr index)');

  if (c.fields.length === 9) {
    const actionConstr = c.fields[4] as Constr<never>;
    return {
      ownerPkh:       c.fields[0] as string,
      ownerStake:     decodeOptionByteArray(c.fields[1]),
      curvePolicyId:  c.fields[2] as string,
      curveAssetName: c.fields[3] as string,
      action:         actionConstr.index === 0 ? 'Buy' : 'Sell',
      amount:         c.fields[5] as bigint,
      minOut:         c.fields[6] as bigint,
      creatorPkh:     c.fields[7] as string,
      treasuryPkh:    c.fields[8] as string,
    };
  }
  if (c.fields.length === 8) {
    // Legacy schema (pre-stake-aware migration). owner_stake omitted.
    const actionConstr = c.fields[3] as Constr<never>;
    return {
      ownerPkh:       c.fields[0] as string,
      ownerStake:     undefined,
      curvePolicyId:  c.fields[1] as string,
      curveAssetName: c.fields[2] as string,
      action:         actionConstr.index === 0 ? 'Buy' : 'Sell',
      amount:         c.fields[4] as bigint,
      minOut:         c.fields[5] as bigint,
      creatorPkh:     c.fields[6] as string,
      treasuryPkh:    c.fields[7] as string,
    };
  }
  throw new Error(`Invalid OrderDatum encoding (field count ${c.fields.length})`);
}

export function encodeOrderRedeemer(r: OrderRedeemer): string {
  return r === 'Execute' ? Data.to(new Constr(0, [])) : Data.to(new Constr(1, []));
}
