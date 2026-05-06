'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/utils';

interface Props {
  policyId:             string;
  assetName:            string;
  creatorAddress:       string;
  vestingAddress:       string;
  vestingValidatorCbor: string;
  vestingUnlockMs:      number;
  vestingClaimedTxHash?: string;
}

function extractErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.split('\n')[0].slice(0, 240);
  if (typeof e === 'string') return e.split('\n')[0].slice(0, 240);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
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

function fmtRemaining(ms: number): string {
  if (ms <= 0) return 'unlocked';
  const s = Math.floor(ms / 1000);
  if (s < 60)        return `${s}s`;
  if (s < 3600)      return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function VestingClaimPanel(props: Props) {
  const { wallet, walletApi } = useWallet();
  const [now, setNow]         = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [txHash, setTxHash]   = useState<string | null>(props.vestingClaimedTxHash ?? null);

  // Tick every second so the countdown updates live.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Only show to the creator. Address comparison is best-effort string match —
  // both values come from the same registry source so they line up.
  const isCreator = wallet?.address === props.creatorAddress;
  if (!isCreator) return null;

  const remaining = props.vestingUnlockMs - now;
  const unlocked  = remaining <= 0;

  if (txHash) {
    return (
      <div
        className="rounded-xl p-4 mb-3"
        style={{ background: 'rgba(92,224,210,0.06)', border: '1px solid rgba(92,224,210,0.25)' }}
      >
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--teal)' }}>
          Vested allocation claimed
        </p>
        <a
          href={txExplorerUrl(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs truncate block"
          style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
        >
          {txHash.slice(0, 18)}…{txHash.slice(-8)}
        </a>
      </div>
    );
  }

  async function handleClaim() {
    if (!walletApi) return;
    setSubmitting(true);
    setError(null);
    try {
      const { claimVestedTokens } = await import('@/lib/cardano-tx');
      const res = await claimVestedTokens(
        walletApi,
        props.vestingAddress,
        props.vestingValidatorCbor,
        props.vestingUnlockMs,
        props.policyId,
        props.assetName,
      );
      setTxHash(res.txHash);
      // Best-effort: persist the claim hash to the registry so reloads stay
      // consistent with reality and the panel shows the success card.
      try {
        await fetch('/api/tokens/vesting-claimed', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ policyId: props.policyId, txHash: res.txHash }),
        });
      } catch { /* registry update is non-critical */ }
    } catch (e) {
      // Lucid Evolution / Effect Schema errors aren't always Error instances —
      // many are plain objects with nested message/cause, so the default
      // String(e) gives "[object Object]". Walk common shapes; log the full
      // value to console so we can debug whatever falls through.
      console.error('[vesting-claim] failed:', e);
      setError(extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="rounded-xl p-4 mb-3 flex flex-col gap-3"
      style={{
        background: unlocked ? 'rgba(92,224,210,0.06)' : 'var(--bg-card)',
        border: `1px solid ${unlocked ? 'rgba(92,224,210,0.25)' : 'var(--border-mid)'}`,
      }}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Creator vesting
        </p>
        <span
          className="text-xs"
          style={{
            color: unlocked ? 'var(--teal)' : 'var(--text)',
            fontFamily: 'var(--font-jetbrains), monospace',
          }}
        >
          {fmtRemaining(remaining)}
        </span>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
        {unlocked
          ? 'Your dev allocation is unlocked. Claim now.'
          : `Unlocks at ${new Date(props.vestingUnlockMs).toLocaleString()}.`}
      </p>

      <button
        type="button"
        onClick={handleClaim}
        disabled={!unlocked || submitting}
        style={{
          height: 38,
          borderRadius: 'var(--r-md)',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--font-outfit)',
          cursor: unlocked && !submitting ? 'pointer' : 'not-allowed',
          border: unlocked ? 'none' : '1px solid var(--border-subtle)',
          background: unlocked ? 'var(--teal)' : 'var(--bg-elevated)',
          color: unlocked ? 'var(--bg-deep)' : 'var(--text-dim)',
          boxShadow: unlocked && !submitting ? '0 0 14px rgba(92,224,210,0.32)' : 'none',
          opacity: submitting ? 0.7 : 1,
          transition: 'all 200ms',
        }}
      >
        {submitting ? 'Awaiting signature…' : unlocked ? 'Claim vested allocation' : 'Locked'}
      </button>

      {error && (
        <p className="text-xs" style={{ color: 'var(--lava-bright)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
