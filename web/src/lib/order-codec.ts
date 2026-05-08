// Plutus Data encoders / decoders for OrderDatum + redeemers. Mirror of
// src/cardano/codec.ts kept web-local so the browser bundle stays
// independent of the CLI codepath.

import { Constr, Data } from '@lucid-evolution/lucid';

export type OrderAction = 'Buy' | 'Sell';

export interface OrderDatum {
  ownerPkh:       string;  // hex
  curvePolicyId:  string;  // hex
  curveAssetName: string;  // hex (asset name, NOT prefixed with policy)
  action:         OrderAction;
  amount:         bigint;  // lovelace (Buy) or token units (Sell)
  minOut:         bigint;  // slippage floor — same field used by curve validator
  creatorPkh:     string;  // hex
  treasuryPkh:    string;  // hex
}

export type OrderRedeemer = 'Execute' | 'Cancel';

function encodeOrderAction(a: OrderAction): Constr<never> {
  return a === 'Buy' ? new Constr(0, []) : new Constr(1, []);
}

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
    ownerPkh:       c.fields[0] as string,
    curvePolicyId:  c.fields[1] as string,
    curveAssetName: c.fields[2] as string,
    action,
    amount:         c.fields[4] as bigint,
    minOut:         c.fields[5] as bigint,
    creatorPkh:     c.fields[6] as string,
    treasuryPkh:    c.fields[7] as string,
  };
}

export function encodeOrderRedeemer(r: OrderRedeemer): string {
  return r === 'Execute' ? Data.to(new Constr(0, [])) : Data.to(new Constr(1, []));
}
