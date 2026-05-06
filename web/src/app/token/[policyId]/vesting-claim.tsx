'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet';
import { txExplorerUrl } from '@/lib/utils';

// Creator-only panel on the token detail page.
//
// Two responsibilities:
//   1. List every active vesting position (the launch lockup + any
//      creator-added extras) with a live countdown and per-position claim.
//   2. Expose a "Lock more tokens" form so the creator can voluntarily
//      vest additional tokens at any time — each lock spawns a fresh
//      vesting script (parameterised with the chosen unlock time).

export interface VestingPosition {
  address:        string;
  validatorCbor:  string;
  unlockMs:       number;
  claimedTxHash?: string;
  /** Optional label for the launch position vs added positions. */
  source?:        'launch' | 'extra';
  /** Used only by the API patch when claimed (extras carry it; launch leaves
   *  it undefined and writes to the singular vestingClaimedTxHash). */
  isExtra?:       boolean;
}

interface Props {
  policyId:       string;
  assetName:      string;
  ticker:         string;
  creatorAddress: string;
  positions:      VestingPosition[];
}

export function VestingClaimPanel({ policyId, assetName, ticker, creatorAddress, positions }: Props) {
  const { wallet, walletApi } = useWallet();
  const isCreator = wallet?.address === creatorAddress;
  if (!isCreator) return null;
  if (positions.length === 0 && !walletApi) return null;

  return (
    <div className="flex flex-col gap-3 mb-3">
      {positions.map(p => (
        <VestingRow
          key={p.address}
          policyId={policyId}
          assetName={assetName}
          position={p}
        />
      ))}
      <ReVestForm
        policyId={policyId}
        assetName={assetName}
        ticker={ticker}
      />
    </div>
  );
}

// ── Single vesting row ──────────────────────────────────────────────────────

function VestingRow({
  policyId,
  assetName,
  position,
}: {
  policyId: string;
  assetName: string;
  position: VestingPosition;
}) {
  const { walletApi } = useWallet();
  const [now, setNow]               = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [txHash, setTxHash]         = useState<string | null>(position.claimedTxHash ?? null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = position.unlockMs - now;
  const unlocked  = remaining <= 0;

  if (txHash) {
    return (
      <div
        className="rounded-xl p-4"
        style={{ background: 'rgba(92,224,210,0.06)', border: '1px solid rgba(92,224,210,0.25)' }}
      >
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--teal)' }}>
          {position.source === 'extra' ? 'Re-vest claimed' : 'Vested allocation claimed'}
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
        position.address,
        position.validatorCbor,
        position.unlockMs,
        policyId,
        assetName,
      );
      setTxHash(res.txHash);
      try {
        await fetch('/api/tokens/vesting-claimed', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            policyId,
            txHash: res.txHash,
            ...(position.isExtra ? { address: position.address } : {}),
          }),
        });
      } catch { /* registry update is non-critical */ }
    } catch (e) {
      console.error('[vesting-claim] failed:', e);
      setError(extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: unlocked ? 'rgba(92,224,210,0.06)' : 'var(--bg-card)',
        border: `1px solid ${unlocked ? 'rgba(92,224,210,0.25)' : 'var(--border-mid)'}`,
      }}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          {position.source === 'extra' ? 'Re-vested lockup' : 'Creator vesting'}
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
          ? 'Unlocked. Claim now.'
          : `Unlocks at ${new Date(position.unlockMs).toLocaleString()}.`}
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
        {submitting ? 'Awaiting signature…' : unlocked ? 'Claim' : 'Locked'}
      </button>

      {error && (
        <p className="text-xs" style={{ color: 'var(--lava-bright)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Re-vest form ────────────────────────────────────────────────────────────

const PRESETS = [
  { label: '1 hour',   ms: 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days',   ms: 7  * 24 * 60 * 60 * 1000 },
  { label: '30 days',  ms: 30 * 24 * 60 * 60 * 1000 },
];

function ReVestForm({
  policyId,
  assetName,
  ticker,
}: {
  policyId: string;
  assetName: string;
  ticker: string;
}) {
  const { walletApi } = useWallet();
  const [open, setOpen]             = useState(false);
  const [amount, setAmount]         = useState('');
  const [presetMs, setPresetMs]     = useState(PRESETS[0].ms);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); setSuccess(null); }}
        className="rounded-xl p-3 text-xs flex items-center justify-center gap-1.5 transition-colors"
        style={{
          background: 'transparent',
          border: '1px dashed var(--border-mid)',
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-outfit)',
          cursor: 'pointer',
        }}
      >
        + Lock more tokens
      </button>
    );
  }

  async function submit() {
    if (!walletApi) { setError('Wallet not connected'); return; }
    const tokens = (() => { try { return BigInt(amount); } catch { return 0n; } })();
    if (tokens <= 0n) { setError('Enter a positive token amount'); return; }
    const unlockMs = Date.now() + presetMs;

    setSubmitting(true);
    setError(null);
    try {
      const { addVestingPosition } = await import('@/lib/cardano-tx');
      const res = await addVestingPosition(walletApi, policyId, assetName, tokens, unlockMs);
      // Persist the new position so reloads see it. Best-effort.
      try {
        await fetch('/api/tokens/vesting-add', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            policyId,
            address:       res.address,
            validatorCbor: res.validatorCbor,
            unlockMs:      res.unlockMs,
          }),
        });
      } catch { /* non-critical */ }
      setSuccess(res.txHash);
      setAmount('');
    } catch (e) {
      console.error('[re-vest] failed:', e);
      setError(extractErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)' }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
          Lock additional tokens
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs"
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0 }}
        >
          close
        </button>
      </div>

      <div className="relative">
        <input
          value={amount}
          onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric"
          placeholder="how many tokens"
          style={{
            width: '100%', height: 40, padding: '0 12px', paddingRight: 60,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--r-sm)',
            color: 'var(--text)', fontSize: 14,
            fontFamily: 'var(--font-jetbrains), monospace',
            outline: 'none',
          }}
        />
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
          style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
        >
          ${ticker}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {PRESETS.map(p => {
          const active = presetMs === p.ms;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => setPresetMs(p.ms)}
              aria-pressed={active}
              style={{
                minHeight: 32,
                borderRadius: 8,
                fontSize: 11,
                fontWeight: active ? 600 : 400,
                fontFamily: 'var(--font-outfit)',
                cursor: 'pointer',
                border: active ? '1px solid var(--teal)' : '1px solid var(--border-subtle)',
                background: active ? 'rgba(92,224,210,0.1)' : 'var(--bg-elevated)',
                color: active ? 'var(--teal)' : 'var(--text-dim)',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
        Locks until{' '}
        <span style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}>
          {new Date(Date.now() + presetMs).toLocaleString()}
        </span>
        . Same on-chain rules as launch vesting: only your wallet can claim,
        only after the unlock time.
      </p>

      <button
        type="button"
        onClick={submit}
        disabled={submitting || !amount}
        style={{
          height: 38,
          borderRadius: 'var(--r-md)',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--font-outfit)',
          cursor: submitting || !amount ? 'not-allowed' : 'pointer',
          border: 'none',
          background: amount && !submitting ? 'var(--teal)' : 'var(--bg-elevated)',
          color: amount && !submitting ? 'var(--bg-deep)' : 'var(--text-dim)',
          boxShadow: amount && !submitting ? '0 0 14px rgba(92,224,210,0.32)' : 'none',
        }}
      >
        {submitting ? 'Awaiting signature…' : 'Lock tokens'}
      </button>

      {success && (
        <a
          href={txExplorerUrl(success)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs truncate"
          style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}
        >
          Locked. Tx: {success.slice(0, 18)}…{success.slice(-8)}
        </a>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--lava-bright)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
