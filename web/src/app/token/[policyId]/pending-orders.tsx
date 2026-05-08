'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { decodeOrderDatum, type OrderDatum } from '@/lib/order-codec';
import { getOrderBookAddress } from '@/lib/order-book';
import { cancelOrder } from '@/lib/order-tx';
import { txExplorerUrl, safeBigInt } from '@/lib/utils';

// Per-token list of the connected wallet's pending orders. Surfaces both
// the queue UX (how many trades the batcher still has to drain) and the
// only available escape hatch when the batcher is unavailable: an
// owner-signed Cancel that reclaims locked funds.
//
// Hidden when:
//   • queue mode is off (NEXT_PUBLIC_USE_QUEUE !== '1')
//   • the wallet is disconnected
//   • the wallet has no pending orders for this token

const NETWORK = (process.env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet' ? 'Mainnet' : 'Preprod') as 'Mainnet' | 'Preprod';
const QUEUE_ON = process.env.NEXT_PUBLIC_USE_QUEUE === '1';

interface RawUtxo {
  tx_hash:      string;
  output_index: number;
  inline_datum: string | null;
  amount:       Array<{ unit: string; quantity: string }>;
}

interface PendingOrder {
  txHash:       string;
  outputIndex:  number;
  datum:        OrderDatum;
  rawAmount:    Array<{ unit: string; quantity: string }>;
}

async function fetchOrdersForOwner(
  ownerPkh: string,
  policyId: string,
  assetName: string,
): Promise<PendingOrder[]> {
  // Hit Blockfrost via our own API — keeps the Blockfrost project ID off
  // the client. The /api/wallet-assets route already proxies similar
  // calls, but for the order book we need utxos at a specific address,
  // so we use a thin proxy: /api/order-book-utxos?address=...
  const orderBookAddress = getOrderBookAddress(NETWORK);
  const res = await fetch(
    `/api/order-book-utxos?address=${encodeURIComponent(orderBookAddress)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return [];
  const utxos = (await res.json()) as RawUtxo[];

  const out: PendingOrder[] = [];
  for (const u of utxos) {
    if (!u.inline_datum) continue;
    try {
      const d = decodeOrderDatum(u.inline_datum);
      if (
        d.curvePolicyId  === policyId &&
        d.curveAssetName === assetName &&
        d.ownerPkh       === ownerPkh
      ) {
        out.push({
          txHash:      u.tx_hash,
          outputIndex: u.output_index,
          datum:       d,
          rawAmount:   u.amount,
        });
      }
    } catch { /* not a recognisable order datum */ }
  }
  return out;
}

function fmtAda(lovelace: bigint) {
  return `${(Number(lovelace) / 1_000_000).toFixed(3)} ₳`;
}

function fmtTokens(qty: bigint) {
  return Number(qty).toLocaleString();
}

export function PendingOrders({
  policyId, assetName, ticker,
}: {
  policyId:  string;
  assetName: string;
  ticker:    string;
}) {
  const { wallet, walletApi } = useWallet();
  const queryClient = useQueryClient();
  const [cancellingRef, setCancellingRef] = useState<string | null>(null);

  const ownerPkh = wallet?.pkh;

  const { data: orders = [] } = useQuery({
    queryKey: ['pending-orders', ownerPkh, policyId, assetName],
    queryFn:  () => fetchOrdersForOwner(ownerPkh!, policyId, assetName),
    enabled:  QUEUE_ON && !!ownerPkh,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (!QUEUE_ON || !wallet || orders.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4 mb-3 flex flex-col gap-2"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)' }}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Pending orders
        </p>
        <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
          {orders.length} queued
        </span>
      </div>

      {orders.map(o => {
        const ref = `${o.txHash}#${o.outputIndex}`;
        const isCancelling = cancellingRef === ref;
        const isBuy = o.datum.action === 'Buy';
        return (
          <div
            key={ref}
            className="flex items-center justify-between gap-3 rounded-md p-2"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <p className="text-[11px] font-semibold" style={{ color: isBuy ? 'var(--teal)' : 'var(--lava)' }}>
                {isBuy ? 'BUY' : 'SELL'}
                <span className="ml-1.5" style={{ color: 'var(--text)' }}>
                  {isBuy ? fmtAda(safeBigInt(o.datum.amount)) : `${fmtTokens(safeBigInt(o.datum.amount))} $${ticker}`}
                </span>
              </p>
              <a
                href={txExplorerUrl(o.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] truncate"
                style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
              >
                {o.txHash.slice(0, 12)}…{o.txHash.slice(-6)}
              </a>
            </div>
            <button
              type="button"
              disabled={isCancelling || !walletApi}
              onClick={async () => {
                if (!walletApi) return;
                setCancellingRef(ref);
                try {
                  await cancelOrder(walletApi, { txHash: o.txHash, outputIndex: o.outputIndex });
                  queryClient.invalidateQueries({ queryKey: ['pending-orders'] });
                } catch (e) {
                  console.error('[pending-orders] cancel failed:', e);
                } finally {
                  setCancellingRef(null);
                }
              }}
              style={{
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: 'var(--font-outfit)',
                borderRadius: 6,
                border: '1px solid var(--border-mid)',
                background: 'var(--bg-card)',
                color: isCancelling ? 'var(--text-dim)' : 'var(--text)',
                cursor: isCancelling ? 'not-allowed' : 'pointer',
              }}
            >
              {isCancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
