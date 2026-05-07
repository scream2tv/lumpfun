'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallet, type Cip30Api } from '@/lib/wallet';
import { quoteBuy, quoteSellGross } from '@/lib/curve-math';
import { txExplorerUrl, safeBigInt } from '@/lib/utils';
import {
  classifyError, emitTxLog, outracedOutcome,
  shouldAutoRetry, TX_UX,
  type TxAttemptLog, type TxOutcome, type TxOutcomeState,
} from '@/lib/tx-errors';

const PLATFORM_FEE = 1_000_000n;
const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS ?? '';
const BF_URL   = process.env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet'
  ? 'https://cardano-mainnet.blockfrost.io/api/v0'
  : 'https://cardano-preprod.blockfrost.io/api/v0';
const BF_KEY   = process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID ?? '';

// ADA quick-pick chips (lovelace amounts)
const BUY_CHIPS  = [
  { label: '50',  value: 50_000_000n },
  { label: '100', value: 100_000_000n },
  { label: '250', value: 250_000_000n },
  { label: '500', value: 500_000_000n },
] as const;
const SELL_PCTS  = [10, 25, 50, 100] as const;

// Default slippage tolerance (bps) for both sides of the curve. We keep this
// tight because LumpFun's bonding curve is exact constant-product on-chain —
// the only price-changing thing between the local quote and submission is a
// competing trade landing in the same block. Other launchpads run higher
// auto-slippage (5%+) because they route through DEXes with shallow off-chain
// liquidity that can shift mid-flight; ours doesn't. Surface this as an
// "advanced" UI control later if creators ask for it; for now keep it fixed
// so users don't foot-gun themselves into a 5% MEV loss on a quiet curve.
const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%

interface CurveState {
  adaReserve: bigint;
  tokenReserve: bigint;
}

interface Props {
  policyId: string;
  assetName: string;
  curveAddress: string;
  creatorAddress: string;
  validatorCbor: string;
  ticker: string;
  creatorFeeBps: number;
  /** Set on tokens launched after the fee accumulator was introduced.
   *  When present, trades route the creator-fee output here instead of
   *  to the creator's wallet directly. */
  feeAccumulatorAddress?: string;
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchCurveState(curveAddress: string, assetUnit: string): Promise<CurveState | null> {
  const res = await fetch(
    `/api/curve?address=${encodeURIComponent(curveAddress)}&asset=${encodeURIComponent(assetUnit)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return { adaReserve: safeBigInt(data.adaReserve), tokenReserve: safeBigInt(data.tokenReserve) };
}

// Sum the asset quantity across ALL wallet UTxOs (CIP-30) — covers wallets like
// Eternl that spread funds across many addresses tied to one stake key.
// Wrapped in a top-level try so a failure inside Lucid's CBOR translation
// (the path that has thrown "Cannot mix BigInt and other types" on certain
// wallet/browser combos) degrades to a 0n balance instead of crashing render.
async function fetchTokenBalance(walletApi: Cip30Api, assetUnit: string): Promise<bigint> {
  try {
    const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');
    const network = process.env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet' ? 'Mainnet' : 'Preprod';
    const lucid = await Lucid(new Blockfrost(BF_URL, BF_KEY), network);
    lucid.selectWallet.fromAPI(walletApi as unknown as Parameters<typeof lucid.selectWallet.fromAPI>[0]);
    const utxos = await lucid.wallet().getUtxos();
    let total = 0n;
    for (const u of utxos) {
      const q = u.assets?.[assetUnit];
      if (q === undefined || q === null) continue;
      total += safeBigInt(q);
    }
    return total;
  } catch (e) {
    console.warn('[fetchTokenBalance] failed:', e);
    return 0n;
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtAda(l: bigint) { return (Number(l) / 1_000_000).toFixed(3); }
function fmtTok(t: bigint) { return Number(t).toLocaleString(); }

// ── Chip components ───────────────────────────────────────────────────────────

function Chip({
  label, selected, accent, onClick, disabled,
}: {
  label: string;
  selected: boolean;
  accent: 'teal' | 'lava';
  onClick: () => void;
  disabled?: boolean;
}) {
  const accentColor  = accent === 'teal' ? 'var(--teal)' : 'var(--lava)';
  const accentBg     = accent === 'teal' ? 'rgba(92, 224, 210, 0.15)' : 'rgba(232, 90, 42, 0.15)';
  const accentBorder = accent === 'teal' ? 'rgba(92, 224, 210, 0.4)' : 'rgba(232, 90, 42, 0.4)';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      style={{
        flex: 1,
        height: 40,
        minHeight: 44,
        borderRadius: 'var(--r-sm)',
        fontSize: 12,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 150ms var(--ease-in-out)',
        fontFamily: 'var(--font-outfit), system-ui, sans-serif',
        border: selected ? `1px solid ${accentBorder}` : '1px solid var(--border-subtle)',
        background: selected ? accentBg : 'var(--bg-elevated)',
        color: selected ? accentColor : 'var(--text-dim)',
        opacity: disabled ? 0.4 : 1,
        outline: 'none',
      }}
      onFocus={e => { if (!disabled) e.currentTarget.style.outline = `2px solid ${accentColor}`; e.currentTarget.style.outlineOffset = '2px'; }}
      onBlur={e => { e.currentTarget.style.outline = 'none'; }}
    >
      {label}
    </button>
  );
}

// ── Address normalizer ────────────────────────────────────────────────────────
// CIP-30 returns hex; older registry rows stored hex in creatorAddress.
// Convert to bech32 before handing to Lucid (which only accepts bech32).
async function toBech32(addr: string): Promise<string> {
  if (!addr) return addr;
  if (addr.startsWith('addr')) return addr;
  try {
    const { CML } = await import('@lucid-evolution/lucid');
    return CML.Address.from_hex(addr).to_bech32(undefined);
  } catch {
    return addr;
  }
}

// ── Error display ─────────────────────────────────────────────────────────────
// classifyError + TX_UX live in @/lib/tx-errors. Anything in this file that
// surfaces an error to the user runs the throwable through classifyError so
// every render path goes through one taxonomy.

// ── Tx success banner ─────────────────────────────────────────────────────────

// Poll /api/tx-status for ~120s after submit to detect the silent-drop case
// (competing trade ate the curve UTxO first → our tx never lands). Cardano
// wallets show such txs as "Pending" until expiry, leaving users staring at
// a stuck UI without knowing the trade was outraced. On confirmation we
// switch to "Confirmed"; on timeout we surface a retry hint.
type TxState = 'pending' | 'confirmed' | 'unconfirmed';

function useTxConfirmation(
  hash: string | null,
  onTerminal?: (state: 'confirmed' | 'unconfirmed', elapsedMs: number) => void,
): TxState {
  const [state, setState] = useState<TxState>('pending');

  useEffect(() => {
    if (!hash) return;
    setState('pending');
    const startedAt = Date.now();
    let cancelled = false;
    let attempts  = 0;
    const MAX_ATTEMPTS = 24; // 24 × 5s = ~120s window

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await fetch(`/api/tx-status?hash=${encodeURIComponent(hash)}`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json() as { confirmed?: boolean };
          if (json.confirmed) {
            if (!cancelled) {
              setState('confirmed');
              onTerminal?.('confirmed', Date.now() - startedAt);
            }
            return;
          }
        }
      } catch { /* network blip — keep polling */ }
      if (attempts >= MAX_ATTEMPTS) {
        if (!cancelled) {
          setState('unconfirmed');
          onTerminal?.('unconfirmed', Date.now() - startedAt);
        }
        return;
      }
      setTimeout(tick, 5_000);
    };
    // Give the chain a beat before the first poll — most blocks are 20s apart.
    const id = setTimeout(tick, 5_000);
    return () => { cancelled = true; clearTimeout(id); };
    // onTerminal is intentionally not in deps — we want the callback at hash
    // birth, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  return state;
}

function TxBanner({
  hash, onDismiss, onTerminal,
}: {
  hash: string;
  onDismiss: () => void;
  onTerminal?: (state: 'confirmed' | 'unconfirmed', elapsedMs: number) => void;
}) {
  const explorerUrl = txExplorerUrl(hash);
  const status      = useTxConfirmation(hash, onTerminal);

  const tone = status === 'confirmed'
    ? { color: 'var(--teal)',       bg: 'rgba(92, 224, 210, 0.08)', border: 'rgba(92, 224, 210, 0.25)' }
    : status === 'unconfirmed'
      ? { color: 'var(--lava-bright)', bg: 'rgba(232, 90, 42, 0.08)',  border: 'rgba(232, 90, 42, 0.25)' }
      : { color: 'var(--teal)',       bg: 'rgba(92, 224, 210, 0.08)', border: 'rgba(92, 224, 210, 0.25)' };

  const headline = status === 'confirmed'
    ? 'Transaction confirmed'
    : status === 'unconfirmed'
      ? 'Transaction did not confirm'
      : 'Transaction submitted';

  const subline = status === 'unconfirmed'
    ? 'Likely outraced by another trade on the same curve. The trade was not applied — you can safely retry.'
    : null;

  return (
    <div
      className="rounded-lg p-3 flex items-start justify-between gap-2"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="text-xs font-semibold" style={{ color: tone.color }}>
          {headline}
          {status === 'pending' && (
            <span className="ml-1.5" style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· awaiting block</span>
          )}
        </p>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs truncate"
          style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
        >
          {hash.slice(0, 16)}…{hash.slice(-8)}
        </a>
        {subline && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-dim)', lineHeight: 1.45 }}>
            {subline}
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ color: 'var(--text-dim)', fontSize: 16, lineHeight: 1, cursor: 'pointer', background: 'none', border: 'none', flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  );
}

// ── Structured error banner ─────────────────────────────────────────────────
// Renders the TX_UX entry for whatever code classifyError produced. Cancels
// (USER_REJECTED) get a softer tone with no CTA; everything else gets the
// red lava treatment plus a primary action.
function ErrorBanner({
  outcome, onRetry, onReconnect, onDismiss,
}: {
  outcome: Exclude<TxOutcome, { state: 'success' }>;
  onRetry?:     () => void;
  onReconnect?: () => void;
  onDismiss:    () => void;
}) {
  const ux       = TX_UX[outcome.code];
  const cancelled = outcome.state === 'user_cancelled';
  const tone = cancelled
    ? { color: 'var(--text-dim)',     bg: 'var(--bg-elevated)',           border: 'var(--border-subtle)' }
    : { color: 'var(--lava-bright)',  bg: 'rgba(232, 90, 42, 0.08)',      border: 'rgba(232, 90, 42, 0.25)' };

  const ctaHandler = ux.cta === 'retry'     ? onRetry
                  : ux.cta === 'reconnect' ? onReconnect
                  : undefined;
  const ctaLabel  = ux.cta === 'retry'     ? 'Retry'
                  : ux.cta === 'reconnect' ? 'Reconnect'
                  : ux.cta === 'report'    ? 'Report'
                  : null;

  return (
    <div
      role="alert"
      className="rounded-lg p-3 flex items-start justify-between gap-3"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <p className="text-xs font-semibold" style={{ color: tone.color, fontFamily: 'var(--font-outfit)' }}>
          {ux.headline}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--text-dim)', lineHeight: 1.45 }}>
          {ux.body}
        </p>
        {ctaLabel && ctaHandler && (
          <button
            type="button"
            onClick={ctaHandler}
            className="self-start mt-1 text-xs font-semibold rounded-md"
            style={{
              padding: '5px 10px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-mid)',
              color: 'var(--text)',
              cursor: 'pointer',
              fontFamily: 'var(--font-outfit)',
            }}
          >
            {ctaLabel}
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ color: 'var(--text-dim)', fontSize: 16, lineHeight: 1, cursor: 'pointer', background: 'none', border: 'none', flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TradePanel({
  policyId, assetName, curveAddress, creatorAddress,
  validatorCbor, ticker, creatorFeeBps, feeAccumulatorAddress,
}: Props) {
  const { wallet, walletApi } = useWallet();
  const assetUnit = `${policyId}${assetName}`;
  const queryClient = useQueryClient();

  // Shared with <LiveStats /> via the same query key — React Query dedupes
  // the network request, so the metric row + trade panel stay in sync off
  // a single 5-second poll. We pull `refetch` so the auto-retry path can
  // pull a fresh curve UTxO before re-attempting on a race-style failure.
  const { data: curve, isLoading: curveLoading, refetch: refetchCurve } = useQuery({
    queryKey: ['curve', curveAddress, assetUnit],
    queryFn:  () => fetchCurveState(curveAddress, assetUnit),
    refetchInterval: 5_000,
  });

  const invalidateCurve = () =>
    queryClient.invalidateQueries({ queryKey: ['curve', curveAddress, assetUnit] });

  const { data: tokenBalance } = useQuery({
    queryKey: ['token-balance', wallet?.address, assetUnit],
    queryFn:  () => fetchTokenBalance(walletApi!, assetUnit),
    enabled:  !!walletApi,
    refetchInterval: 15_000,
  });

  const [tab,          setTab]       = useState<'buy' | 'sell'>('buy');
  const [buyAda,       setBuyAda]    = useState('');
  const [buyChip,      setBuyChip]   = useState<bigint | null>(null);
  const [sellPct,      setSellPct]   = useState<number | null>(null);
  const [sellRaw,      setSellRaw]   = useState('');
  const [submitting,   setSubmitting]= useState(false);
  const [outcome,      setOutcome]   = useState<TxOutcome | null>(null);
  // Track the last attempt's metadata so the post-submit poller (which
  // resolves async, after handleBuy/Sell has returned) can emit the final
  // structured log with the same correlation as the initial attempt.
  // The post-submit confirmation poller resolves async, after runTrade has
  // already returned. Stash just enough correlation here so the poller's
  // terminal callback can emit a single structured TxAttemptLog with
  // confirmedAfterMs (or downgrade to TX_OUTRACED).
  const lastAttemptRef = useRef<{
    op:        'buy' | 'sell';
    startedAt: number;
    attempt:   number;
    txHash:    string;
  } | null>(null);

  // ── Derived values ──────────────────────────────────────────────────────────

  const isBuy = tab === 'buy';

  // Coerce every external value before it touches BigInt arithmetic.
  // tokenBalance comes from the Lucid path (occasionally fails open with 0n);
  // wallet.lovelace is set from CIP-30 CBOR; creatorFeeBps from the registry.
  // If any of these arrive as a Number on a wonky wallet/browser combo, the
  // render-time `*` / `+` ops would otherwise throw and trip the boundary.
  const tokenBalanceB    = safeBigInt(tokenBalance);
  const walletLovelaceB  = wallet ? safeBigInt(wallet.lovelace) : 0n;
  const creatorFeeBpsB   = safeBigInt(creatorFeeBps);

  const buyAdaL: bigint = (() => {
    if (buyChip) return buyChip;
    const n = parseFloat(buyAda);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.floor(n * 1_000_000));
  })();

  const buyQuote = curve && buyAdaL > 0n
    ? quoteBuy(curve.adaReserve, curve.tokenReserve, buyAdaL)
    : null;

  const sellUnits: bigint = (() => {
    if (sellPct !== null && tokenBalanceB > 0n) {
      // 100% sells the entire balance; others floor-divide
      return (tokenBalanceB * safeBigInt(sellPct)) / 100n;
    }
    const n = parseInt(sellRaw, 10);
    return Number.isFinite(n) && n > 0 ? BigInt(n) : 0n;
  })();

  const grossL     = curve && sellUnits > 0n
    ? quoteSellGross(curve.adaReserve, curve.tokenReserve, sellUnits) : 0n;
  const creatorFeeL = (grossL * creatorFeeBpsB) / 10000n;
  const netL        = grossL > PLATFORM_FEE + creatorFeeL
    ? grossL - PLATFORM_FEE - creatorFeeL : 0n;

  // Buy-side creator fee: same bps × ada_in (matches validate_buy on-chain).
  const creatorBuyFeeL = (buyAdaL * creatorFeeBpsB) / 10000n;

  const insufficientAda = buyAdaL > 0n && wallet && walletLovelaceB < buyAdaL + PLATFORM_FEE + creatorBuyFeeL + 2_000_000n;
  const insufficientTokens = sellUnits > 0n && tokenBalance !== undefined && sellUnits > tokenBalanceB;

  const buyDisabled  = submitting || !wallet || !buyAdaL || curveLoading || !!insufficientAda;
  const sellDisabled = submitting || !wallet || !sellUnits || curveLoading || !!insufficientTokens;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const switchTab = useCallback((t: 'buy' | 'sell') => {
    setTab(t); setOutcome(null);
  }, []);

  function handleBuyChip(value: bigint) {
    if (buyChip === value) {
      setBuyChip(null); setBuyAda('');
    } else {
      setBuyChip(value);
      // Mirror the chip's ADA amount into the input so the user sees the
      // exact number they're spending and can edit it before submitting.
      setBuyAda((Number(value) / 1_000_000).toString());
    }
    setOutcome(null);
  }

  function handleBuyInput(v: string) {
    setBuyAda(v); setBuyChip(null); setOutcome(null);
  }

  function handleSellPct(pct: number) {
    if (sellPct === pct) {
      setSellPct(null); setSellRaw(''); setOutcome(null);
      return;
    }
    setSellPct(pct);
    // Populate the input field with the calculated token amount so the user
    // sees the exact number they're selling and can edit it before submitting.
    if (tokenBalanceB > 0n) {
      const amt = (tokenBalanceB * safeBigInt(pct)) / 100n;
      setSellRaw(amt.toString());
    } else {
      setSellRaw('');
    }
    setOutcome(null);
  }

  function handleSellInput(v: string) {
    setSellRaw(v); setSellPct(null); setOutcome(null);
  }

  // ── Trade attempt (shared buy/sell core) ───────────────────────────────────
  // Wraps the Lucid call with classification, structured logging, and a
  // single auto-retry for race-style failures (CURVE_UTXO_GONE /
  // VALIDATOR_REJECTED). Every code path leaves either an outcome on screen
  // or kicks off the post-submit confirmation poller — never both unset.
  async function runTrade(op: 'buy' | 'sell', attempt = 1): Promise<void> {
    if (!walletApi || !curve) return;
    if (!TREASURY) {
      const out: TxOutcome = { state: 'contact_support', code: 'CONFIG_ERROR', raw: 'NEXT_PUBLIC_TREASURY_ADDRESS missing' };
      setOutcome(out);
      finalizeLog({ op, attempt, startedAt: Date.now(), result: out });
      return;
    }

    const startedAt = Date.now();
    if (attempt === 1) { setSubmitting(true); setOutcome(null); }

    try {
      const snapshot = {
        adaReserve:   curve.adaReserve,
        tokenReserve: curve.tokenReserve,
        txHash:       '',
        outputIndex:  0,
        lovelace:     curve.adaReserve,
      };
      const [treasuryBech32, creatorBech32] = await Promise.all([
        toBech32(TREASURY),
        toBech32(creatorAddress),
      ]);

      let res: { txHash: string };
      if (op === 'buy') {
        if (!buyAdaL) return;
        const { buyTokens } = await import('@/lib/cardano-tx');
        res = await buyTokens(
          walletApi, snapshot, buyAdaL, DEFAULT_SLIPPAGE_BPS, creatorFeeBps,
          policyId, assetName, curveAddress, validatorCbor,
          treasuryBech32, creatorBech32, feeAccumulatorAddress,
        );
        setBuyAda(''); setBuyChip(null);
      } else {
        if (!sellUnits) return;
        const { sellTokens } = await import('@/lib/cardano-tx');
        res = await sellTokens(
          walletApi, snapshot, sellUnits, DEFAULT_SLIPPAGE_BPS, creatorFeeBps,
          policyId, assetName, curveAddress, validatorCbor,
          treasuryBech32, creatorBech32, feeAccumulatorAddress,
        );
        setSellRaw(''); setSellPct(null);
      }

      // Submit accepted. Park correlation for the post-submit poller so it
      // can emit the terminal log with confirmedAfterMs once /api/tx-status
      // resolves (or the 120 s window expires → TX_OUTRACED).
      lastAttemptRef.current = { op, startedAt, attempt, txHash: res.txHash };
      setOutcome({ state: 'success', txHash: res.txHash });
      invalidateCurve();
    } catch (e) {
      const cls = classifyError(e);
      let result: TxOutcome;
      if (cls.state === 'user_cancelled') {
        result = { state: 'user_cancelled', code: 'USER_REJECTED', raw: cls.raw };
      } else if (cls.state === 'retry_safe') {
        result = { state: 'retry_safe', code: cls.code, raw: cls.raw };
      } else {
        result = { state: 'contact_support', code: cls.code, raw: cls.raw };
      }

      // Auto-retry once on race-style failures: refetch the curve so the
      // next attempt sees the new reserves, then recurse with attempt+1.
      if (shouldAutoRetry(cls.code, attempt)) {
        await refetchCurve();
        return runTrade(op, attempt + 1);
      }

      console.error(`[trade] ${op} failed:`, e);
      setOutcome(result);
      finalizeLog({ op, attempt, startedAt, result, errorRaw: cls.raw });
    } finally {
      setSubmitting(false);
    }
  }

  function finalizeLog(args: {
    op: 'buy' | 'sell';
    attempt: number;
    startedAt: number;
    result: TxOutcome;
    errorRaw?: string;
    confirmedAfterMs?: number;
  }) {
    const log: TxAttemptLog = {
      ts:                 new Date().toISOString(),
      op:                 args.op,
      policyId,
      assetUnit,
      walletName:         wallet?.name ?? 'unknown',
      network:            (process.env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet' ? 'Mainnet' : 'Preprod'),
      adaIn:              args.op === 'buy'  ? buyAdaL.toString()  : undefined,
      tokensIn:           args.op === 'sell' ? sellUnits.toString() : undefined,
      curveAdaReserve:    curve?.adaReserve.toString(),
      curveTokenReserve:  curve?.tokenReserve.toString(),
      creatorFeeBps,
      slippageBps:        DEFAULT_SLIPPAGE_BPS,
      outcome:            args.result.state as TxOutcomeState,
      code:               args.result.state === 'success' ? undefined : (args.result as Exclude<TxOutcome, { state: 'success' }>).code,
      txHash:             args.result.state === 'success' ? args.result.txHash : undefined,
      durationMs:         Date.now() - args.startedAt,
      retryCount:         args.attempt - 1,
      errorMessage:       args.errorRaw?.split('\n')[0].slice(0, 240),
      errorRaw:           args.errorRaw?.slice(0, 1024),
      confirmedAfterMs:   args.confirmedAfterMs,
    };
    emitTxLog(log);
  }

  // Triggered from the post-submit confirmation poller. Translates the
  // poll's terminal state into a final TxOutcome + log record so success
  // and TX_OUTRACED both flow through the same logging pipeline.
  const handleTxTerminal = useCallback((state: 'confirmed' | 'unconfirmed', elapsedMs: number) => {
    const ctx = lastAttemptRef.current;
    if (!ctx) return;
    if (state === 'confirmed') {
      finalizeLog({
        op:               ctx.op,
        attempt:          ctx.attempt,
        startedAt:        ctx.startedAt,
        result:           { state: 'success', txHash: ctx.txHash },
        confirmedAfterMs: elapsedMs,
      });
    } else {
      const out = outracedOutcome();
      setOutcome(out);
      finalizeLog({
        op:        ctx.op,
        attempt:   ctx.attempt,
        startedAt: ctx.startedAt,
        result:    out,
        errorRaw:  out.raw,
      });
    }
    lastAttemptRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleBuy() {
    await runTrade('buy');
  }

  async function handleSell() {
    // Debug breadcrumb for the "press Sell → 404" reports. Logs the gating
    // state so we can see whether the click was handled or the click escaped
    // to a parent navigation handler somehow.
    console.debug('[trade] sell click', {
      hasWallet:  !!walletApi,
      hasCurve:   !!curve,
      sellUnits:  sellUnits.toString(),
      curveAddr:  curveAddress,
      assetUnit,
      url:        typeof window !== 'undefined' ? window.location.href : '',
    });
    await runTrade('sell');
  }

  // ── Shared styles ───────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 40,
    padding: '0 12px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--r-sm)',
    color: 'var(--text)',
    fontSize: 14,
    fontFamily: 'var(--font-outfit), system-ui, sans-serif',
    outline: 'none',
    transition: 'border-color 150ms, box-shadow 150ms',
  };

  const tabAccent = isBuy ? 'var(--teal)' : 'var(--lava)';

  function ctaStyle(disabled: boolean, accent: string): React.CSSProperties {
    return {
      width: '100%',
      height: 42,
      borderRadius: 'var(--r-md)',
      fontSize: 14,
      fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 200ms var(--ease-in-out)',
      fontFamily: 'var(--font-outfit), system-ui, sans-serif',
      border: disabled ? '1px solid var(--border-subtle)' : 'none',
      background: disabled ? 'var(--bg-elevated)' : accent,
      color: disabled ? 'var(--text-dim)' : accent === 'var(--teal)' ? 'var(--bg-deep)' : '#fff',
      boxShadow: disabled ? 'none'
        : accent === 'var(--teal)' ? '0 0 16px rgba(92, 224, 210, 0.4)'
        : '0 0 16px rgba(232, 90, 42, 0.45)',
    };
  }

  // ── Disconnected overlay message ────────────────────────────────────────────

  const disconnectedNote = !wallet && (
    <p className="text-xs text-center" style={{ color: 'var(--text-dim)' }}>
      Connect your wallet to trade
    </p>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)' }}
    >
      {/* Outcome banner — exactly one of:
            success           → TxBanner (polls /api/tx-status until confirmed/outraced)
            user_cancelled    → soft cancel notice
            retry_safe        → red banner + Retry/Reconnect CTA
            contact_support   → red banner + Report CTA
          The poller's terminal callback re-emits `outcome` if it ages into TX_OUTRACED. */}
      {outcome?.state === 'success' && (
        <TxBanner
          hash={outcome.txHash}
          onDismiss={() => setOutcome(null)}
          onTerminal={handleTxTerminal}
        />
      )}
      {outcome && outcome.state !== 'success' && (
        <ErrorBanner
          outcome={outcome}
          onRetry={() => runTrade(tab)}
          onDismiss={() => setOutcome(null)}
        />
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-elevated)' }}>
        {(['buy', 'sell'] as const).map(t => {
          const active = tab === t;
          const bg     = active ? (t === 'buy' ? 'var(--teal)' : 'var(--lava)') : 'transparent';
          const color  = active ? (t === 'buy' ? 'var(--bg-deep)' : '#fff') : 'var(--text-dim)';
          const glow   = active
            ? (t === 'buy' ? '0 0 12px rgba(92, 224, 210, 0.35)' : '0 0 12px rgba(232, 90, 42, 0.4)')
            : 'none';
          return (
            <button
              key={t}
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(t)}
              style={{
                flex: 1, height: 36, borderRadius: 'var(--r-sm)',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                transition: 'all 200ms var(--ease-in-out)',
                fontFamily: 'var(--font-outfit), system-ui, sans-serif',
                border: 'none', background: bg, color, boxShadow: glow,
              }}
            >
              {t === 'buy' ? 'Buy' : 'Sell'}
            </button>
          );
        })}
      </div>

      {/* ── BUY ── */}
      {isBuy && (
        <div className="flex flex-col gap-3">
          {/* Quick chips */}
          <div>
            <p className="text-xs mb-1.5" style={{ color: 'var(--text-dim)' }}>Quick amount (ADA)</p>
            <div className="flex gap-1.5" role="group" aria-label="ADA amount presets">
              {BUY_CHIPS.map(c => (
                <Chip
                  key={c.label}
                  label={c.label}
                  selected={buyChip === c.value}
                  accent="teal"
                  onClick={() => handleBuyChip(c.value)}
                  disabled={!wallet}
                />
              ))}
            </div>
          </div>

          {/* Manual input */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: 'var(--text-dim)' }}>
              Or enter amount
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text" inputMode="decimal" placeholder="0.0"
                value={buyAda}
                onChange={e => handleBuyInput(e.target.value.replace(/[^\d.]/g, ''))}
                style={inputStyle}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--teal)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(92, 224, 210, 0.1)';
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <span
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 12, color: 'var(--text-dim)', pointerEvents: 'none',
                }}
              >
                ADA
              </span>
            </div>
          </div>

          {/* Quote */}
          {curveLoading && buyAdaL > 0n && (
            <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--bg-elevated)', color: 'var(--text-dim)' }}>
              Fetching quote…
            </div>
          )}
          {!curveLoading && buyQuote !== null && buyQuote > 0n && (
            <div
              className="rounded-lg p-3 text-xs flex flex-col gap-1.5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex justify-between items-baseline">
                <span style={{ color: 'var(--text-dim)' }}>You receive</span>
                <span style={{ color: 'var(--teal)', fontWeight: 700, fontSize: 13 }}>
                  {fmtTok(buyQuote)} ${ticker}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-dim)' }}>Platform fee</span>
                <span style={{ color: 'var(--text)' }}>1 ADA</span>
              </div>
              {creatorBuyFeeL > 0n && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-dim)' }}>Creator ({creatorFeeBps / 100}%)</span>
                  <span style={{ color: 'var(--text)' }}>{fmtAda(creatorBuyFeeL)} ₳</span>
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-dim)' }}>Slippage tolerance</span>
                <span style={{ color: 'var(--text)' }}>0.5%</span>
              </div>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleBuy}
            disabled={buyDisabled}
            style={ctaStyle(buyDisabled, 'var(--teal)')}
          >
            {!wallet
              ? 'Connect wallet to buy'
              : submitting
              ? 'Awaiting signature…'
              : insufficientAda
              ? 'Insufficient ADA'
              : !buyAdaL
              ? 'Enter amount'
              : 'Buy'}
          </button>

          {/* Inline error rendering moved to the top-level ErrorBanner. */}
          {disconnectedNote}
        </div>
      )}

      {/* ── SELL ── */}
      {!isBuy && (
        <div className="flex flex-col gap-3">
          {/* Balance line */}
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Your balance</p>
            <p
              className="text-xs font-semibold tabular-nums"
              style={{ color: wallet ? 'var(--text)' : 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
            >
              {wallet
                ? tokenBalance !== undefined
                  ? `${fmtTok(tokenBalanceB)} $${ticker}`
                  : 'Loading…'
                : `— Connect wallet`}
            </p>
          </div>

          {/* % chips */}
          {wallet ? (
            <div>
              <p className="text-xs mb-1.5" style={{ color: 'var(--text-dim)' }}>Sell percentage</p>
              <div className="flex gap-1.5" role="group" aria-label="Sell percentage presets">
                {SELL_PCTS.map(pct => (
                  <Chip
                    key={pct}
                    label={`${pct}%`}
                    selected={sellPct === pct}
                    accent="lava"
                    onClick={() => handleSellPct(pct)}
                    disabled={tokenBalanceB === 0n}
                  />
                ))}
              </div>
              {tokenBalance !== undefined && tokenBalanceB === 0n && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                  No ${ticker} in wallet
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
              Connect wallet to use % chips
            </p>
          )}

          {/* Manual input */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: 'var(--text-dim)' }}>
              Or enter token amount
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text" inputMode="numeric" placeholder="0"
                value={sellRaw}
                onChange={e => handleSellInput(e.target.value.replace(/[^\d]/g, ''))}
                style={inputStyle}
                onFocus={e => {
                  e.currentTarget.style.borderColor = 'var(--lava)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(232, 90, 42, 0.1)';
                }}
                onBlur={e => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <span
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 12, color: 'var(--text-dim)', pointerEvents: 'none',
                }}
              >
                ${ticker}
              </span>
            </div>
          </div>

          {/* Fee breakdown */}
          {netL > 0n && (
            <div
              className="rounded-lg p-3 text-xs flex flex-col gap-1.5"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-dim)' }}>Gross ADA</span>
                <span style={{ color: 'var(--text)' }}>{fmtAda(grossL)} ₳</span>
              </div>
              {creatorFeeL > 0n && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--text-dim)' }}>Creator ({creatorFeeBps / 100}%)</span>
                  <span style={{ color: 'var(--lava-bright)' }}>−{fmtAda(creatorFeeL)} ₳</span>
                </div>
              )}
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-dim)' }}>Platform fee</span>
                <span style={{ color: 'var(--lava-bright)' }}>−1.000 ₳</span>
              </div>
              <div
                className="flex justify-between pt-2 mt-0.5"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>You receive</span>
                <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{fmtAda(netL)} ₳</span>
              </div>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleSell}
            disabled={sellDisabled}
            style={ctaStyle(sellDisabled, 'var(--lava)')}
          >
            {!wallet
              ? 'Connect wallet to sell'
              : submitting
              ? 'Awaiting signature…'
              : insufficientTokens
              ? 'Insufficient tokens'
              : !sellUnits
              ? 'Select amount'
              : 'Sell'}
          </button>

          {/* Inline error rendering moved to the top-level ErrorBanner. */}
          {disconnectedNote}
        </div>
      )}
    </div>
  );
}
