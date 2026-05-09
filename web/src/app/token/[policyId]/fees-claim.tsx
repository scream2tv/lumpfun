'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/lib/wallet';
import { txExplorerUrl, safeBigInt } from '@/lib/utils';
import { rawErrorString } from '@/lib/tx-errors';

// Per-token "Creator fees" panel. Public-readable balances (anyone can see
// what's accrued and what's been swept); claim button is creator-only.
// Polls /api/fee-accumulator every 15s so trade activity reflects within
// seconds and "claimed" updates the moment a sweep tx confirms.

interface Props {
  policyId:                    string;
  creatorAddress:              string;
  feeAccumulatorAddress:       string;
  feeAccumulatorValidatorCbor: string;
  initialUnclaimed:            string; // bigint as string
  initialClaimed:              string; // bigint as string
  initialClaimedTxHash?:       string;
}

interface Stats { unclaimed: bigint; claimed: bigint }

function fmtAda(lovelace: bigint, decimals = 3): string {
  const ada = Number(lovelace) / 1_000_000;
  if (ada >= 1000) return `${(ada / 1000).toFixed(2)}K ₳`;
  if (ada >= 1)    return `${ada.toFixed(decimals)} ₳`;
  return `${ada.toFixed(4)} ₳`;
}

// Defers to the central rawErrorString in @/lib/tx-errors so Lucid's
// Effect-wrapped failures (TxSignerError, TxSubmitError) unwrap to the
// underlying CIP-30 {code, info} payload instead of bottoming out at
// "[object Object]". Truncates the result for display.
function extractErrorMessage(e: unknown): string {
  return rawErrorString(e).split('\n')[0].slice(0, 240);
}

export function CreatorFeesPanel(props: Props) {
  const { wallet, walletApi } = useWallet();
  const isCreator = wallet?.address === props.creatorAddress;

  const initial: Stats = {
    unclaimed: safeBigInt(props.initialUnclaimed),
    claimed:   safeBigInt(props.initialClaimed),
  };

  const { data: stats = initial } = useQuery<Stats>({
    queryKey: ['fee-accumulator', props.feeAccumulatorAddress],
    queryFn: async () => {
      const res = await fetch(
        `/api/fee-accumulator?address=${encodeURIComponent(props.feeAccumulatorAddress)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return initial;
      const json = await res.json() as { unclaimed: string; claimed: string };
      return { unclaimed: safeBigInt(json.unclaimed), claimed: safeBigInt(json.claimed) };
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    initialData: initial,
  });

  const lifetime = stats.unclaimed + stats.claimed;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [txHash, setTxHash]         = useState<string | null>(props.initialClaimedTxHash ?? null);

  const hasUnclaimed = stats.unclaimed > 0n;
  const hasActivity  = lifetime > 0n;

  return (
    <div
      className="rounded-xl p-4 mb-3 flex flex-col gap-3"
      style={{
        background: hasUnclaimed ? 'rgba(92,224,210,0.06)' : 'var(--bg-card)',
        border: `1px solid ${hasUnclaimed ? 'rgba(92,224,210,0.25)' : 'var(--border-mid)'}`,
      }}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Creator fees
        </p>
        {hasActivity && (
          <span className="text-[11px]" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}>
            lifetime {fmtAda(lifetime, 2)}
          </span>
        )}
      </div>

      {/* Two-up split: unclaimed (highlighted) | claimed */}
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Unclaimed"
          value={fmtAda(stats.unclaimed)}
          tone={hasUnclaimed ? 'teal' : 'mute'}
        />
        <Stat
          label="Claimed"
          value={fmtAda(stats.claimed)}
          tone="mute"
        />
      </div>

      {txHash ? (
        <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
          Last sweep:{' '}
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
        <p className="text-[11px]" style={{ color: 'var(--text-dim)', lineHeight: 1.5 }}>
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
            disabled={!hasUnclaimed || submitting}
            style={{
              height: 38,
              borderRadius: 'var(--r-md)',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'var(--font-outfit)',
              cursor: hasUnclaimed && !submitting ? 'pointer' : 'not-allowed',
              border: hasUnclaimed ? 'none' : '1px solid var(--border-subtle)',
              background: hasUnclaimed ? 'var(--teal)' : 'var(--bg-elevated)',
              color: hasUnclaimed ? 'var(--bg-deep)' : 'var(--text-dim)',
              boxShadow: hasUnclaimed && !submitting ? '0 0 14px rgba(92,224,210,0.32)' : 'none',
              opacity: submitting ? 0.7 : 1,
              transition: 'all 200ms',
            }}
          >
            {submitting
              ? 'Awaiting signature…'
              : hasUnclaimed
                ? `Sweep ${fmtAda(stats.unclaimed)} to wallet`
                : 'Nothing to sweep yet'}
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

function Stat({ label, value, tone }: { label: string; value: string; tone: 'teal' | 'mute' }) {
  return (
    <div
      className="rounded-lg px-3 py-2 flex flex-col gap-0.5"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${tone === 'teal' ? 'rgba(92,224,210,0.35)' : 'var(--border-subtle)'}`,
      }}
    >
      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <span
        className="text-sm font-semibold tabular-nums"
        style={{
          color: tone === 'teal' ? 'var(--teal)' : 'var(--text)',
          fontFamily: 'var(--font-jetbrains), monospace',
        }}
      >
        {value}
      </span>
    </div>
  );
}
