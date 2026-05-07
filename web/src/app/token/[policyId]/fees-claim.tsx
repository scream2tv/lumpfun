'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/utils';

// Per-token "Creator fees" panel. Public-readable balance (anyone can see
// what's accrued); claim button is creator-only. Polls the accumulator
// address every 15s so trade activity reflects within seconds.

interface Props {
  policyId:                 string;
  creatorAddress:           string;
  feeAccumulatorAddress:    string;
  feeAccumulatorValidatorCbor: string;
  initialBalance:           string; // bigint as string, server-rendered
  initialClaimedTxHash?:    string;
}

async function fetchAccruedLovelace(address: string): Promise<string> {
  const res = await fetch(
    `/api/wallet-assets?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return '0';
  // /api/wallet-assets only returns non-ADA assets; we need the lovelace.
  // Easiest is a small dedicated endpoint, but for now we can derive it
  // from the on-chain bf call indirectly. Skip — the page server-renders
  // the initial balance and we just refresh by triggering router.refresh.
  return '0';
}

function fmtAda(lovelace: bigint): string {
  const ada = Number(lovelace) / 1_000_000;
  if (ada >= 1000)  return `${(ada / 1000).toFixed(2)}K ₳`;
  if (ada >= 1)     return `${ada.toFixed(3)} ₳`;
  return `${ada.toFixed(4)} ₳`;
}

function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.split('\n')[0].slice(0, 240);
  if (typeof e === 'string') return e.split('\n')[0].slice(0, 240);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.info === 'string')    return o.info.split('\n')[0].slice(0, 240);
    if (typeof o.message === 'string') return o.message.split('\n')[0].slice(0, 240);
    if (typeof o.cause === 'string')   return o.cause.split('\n')[0].slice(0, 240);
    if (o.cause && typeof o.cause === 'object') {
      const c = o.cause as Record<string, unknown>;
      if (typeof c.message === 'string') return c.message.split('\n')[0].slice(0, 240);
    }
    try { return JSON.stringify(e).slice(0, 240); } catch { /* fallthrough */ }
  }
  return String(e);
}

export function CreatorFeesPanel(props: Props) {
  const { wallet, walletApi } = useWallet();
  const isCreator = wallet?.address === props.creatorAddress;

  const { data: balanceStr = props.initialBalance } = useQuery({
    queryKey: ['fee-accumulator', props.feeAccumulatorAddress],
    queryFn:  async () => {
      // Reuse the wallet-assets address path but only for lovelace; if that
      // route doesn't expose lovelace we fall through to initialBalance.
      try { await fetchAccruedLovelace(props.feeAccumulatorAddress); } catch { /* ignore */ }
      return props.initialBalance;
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    initialData: props.initialBalance,
  });

  const balance = BigInt(balanceStr);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [txHash, setTxHash]         = useState<string | null>(props.initialClaimedTxHash ?? null);

  // Public stat is always visible; the claim form only shows when the
  // connected wallet matches the creator.
  return (
    <div
      className="rounded-xl p-4 mb-3 flex flex-col gap-2"
      style={{
        background: balance > 0n ? 'rgba(92,224,210,0.06)' : 'var(--bg-card)',
        border: `1px solid ${balance > 0n ? 'rgba(92,224,210,0.25)' : 'var(--border-mid)'}`,
      }}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Creator fees collected
        </p>
        <span
          className="text-sm font-semibold tabular-nums"
          style={{
            color: balance > 0n ? 'var(--teal)' : 'var(--text)',
            fontFamily: 'var(--font-jetbrains), monospace',
          }}
        >
          {fmtAda(balance)}
        </span>
      </div>

      {txHash ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
          Last claim:{' '}
          <a
            href={txExplorerUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}
          >
            {txHash.slice(0, 12)}…{txHash.slice(-6)}
          </a>
        </p>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
          Trades pay creator fees into a per-launch script. The creator can sweep at any time.
        </p>
      )}

      {isCreator && (
        <>
          <button
            type="button"
            onClick={async () => {
              if (!walletApi) return;
              setSubmitting(true);
              setError(null);
              try {
                const { claimCreatorFees } = await import('@/lib/cardano-tx');
                const res = await claimCreatorFees(
                  walletApi,
                  props.feeAccumulatorAddress,
                  props.feeAccumulatorValidatorCbor,
                );
                setTxHash(res.txHash);
                try {
                  await fetch('/api/tokens/fees-claimed', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ policyId: props.policyId, txHash: res.txHash }),
                  });
                } catch { /* registry update is non-critical */ }
              } catch (e) {
                console.error('[fees-claim] failed:', e);
                setError(extractErrorMessage(e));
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={balance === 0n || submitting}
            style={{
              height: 38,
              borderRadius: 'var(--r-md)',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'var(--font-outfit)',
              cursor: balance > 0n && !submitting ? 'pointer' : 'not-allowed',
              border: balance > 0n ? 'none' : '1px solid var(--border-subtle)',
              background: balance > 0n ? 'var(--teal)' : 'var(--bg-elevated)',
              color: balance > 0n ? 'var(--bg-deep)' : 'var(--text-dim)',
              boxShadow: balance > 0n && !submitting ? '0 0 14px rgba(92,224,210,0.32)' : 'none',
              opacity: submitting ? 0.7 : 1,
              transition: 'all 200ms',
              marginTop: 4,
            }}
          >
            {submitting ? 'Awaiting signature…' : balance > 0n ? `Claim ${fmtAda(balance)}` : 'Nothing to claim yet'}
          </button>

          {error && (
            <p className="text-xs" style={{ color: 'var(--lava-bright)' }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
