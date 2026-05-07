'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallet, type Cip30Api } from '@/lib/wallet';
import { quoteBuy, quoteSellGross } from '@/lib/curve-math';
import { txExplorerUrl } from '@/lib/utils';

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
  return { adaReserve: BigInt(data.adaReserve), tokenReserve: BigInt(data.tokenReserve) };
}

// Sum the asset quantity across ALL wallet UTxOs (CIP-30) — covers wallets like
// Eternl that spread funds across many addresses tied to one stake key.
async function fetchTokenBalance(walletApi: Cip30Api, assetUnit: string): Promise<bigint> {
  const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');
  const network = process.env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet' ? 'Mainnet' : 'Preprod';
  const lucid = await Lucid(new Blockfrost(BF_URL, BF_KEY), network);
  // Our Cip30Api is a typed subset of Lucid's WalletApi — the underlying object
  // is the full CIP-30 API at runtime, so cast is safe.
  lucid.selectWallet.fromAPI(walletApi as unknown as Parameters<typeof lucid.selectWallet.fromAPI>[0]);
  const utxos = await lucid.wallet().getUtxos();
  let total = 0n;
  for (const u of utxos) total += u.assets[assetUnit] ?? 0n;
  return total;
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

// ── Error message mapper ──────────────────────────────────────────────────────

// Extract a readable string from whatever the wallet / Lucid throws. CIP-30
// errors (Vespr, Eternl, Lace) come back as { code, info } plain objects,
// not Error instances, so the previous String(e) path gave "[object Object]".
function rawErrorString(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    // CIP-30: { code: number, info: string }
    if (typeof o.info === 'string') {
      const code = typeof o.code === 'number' ? ` (code ${o.code})` : '';
      return `${o.info}${code}`;
    }
    if (typeof o.message === 'string') return o.message;
    if (typeof o.cause === 'string')   return o.cause;
    if (o.cause && typeof o.cause === 'object') {
      const c = o.cause as Record<string, unknown>;
      if (typeof c.message === 'string') return c.message;
    }
    try { return JSON.stringify(e); } catch { /* fallthrough */ }
  }
  return String(e);
}

function friendlyError(e: unknown, op: 'buy' | 'sell'): string {
  const raw = rawErrorString(e);
  const m = raw.toLowerCase();
  // Pre-sign declines vary by wallet:
  //   Nami / Eternl     → "user declined" / "user rejected"
  //   Vespr             → "transaction declined" / "user_declined"
  //   Lace              → "cancelled"
  //   Yoroi             → "rejected by user"
  if (
    m.includes('user declined') || m.includes('user rejected') ||
    m.includes('cancelled')     || m.includes('user_declined') ||
    m.includes('rejected by user') || m.includes('transaction declined') ||
    m.includes('declined to sign')
  )
    return 'Transaction cancelled.';
  if (m.includes('collateral'))
    return 'No collateral UTxO set — enable collateral in your wallet settings.';
  if (m.includes('utxo balance insufficient') || m.includes('input balance insufficient'))
    return 'Insufficient ADA — add more to your wallet.';
  // Lucid's "Not enough ADA leftover to include non-ADA assets in a change
  // address" — happens when the wallet is fragmented across many small UTxOs
  // that each carry a few tokens, so the change output can't satisfy
  // Cardano's min-ADA-per-token-bundle rule. Most common on creator wallets
  // that have collected many small fee payments. Telling the user to "send
  // all your ADA to yourself" forces the wallet to consolidate into one
  // larger UTxO that has enough ADA headroom.
  if (m.includes('not enough ada leftover') || m.includes('change address'))
    return 'Wallet UTxOs are fragmented — Cardano can\'t fit your tokens into a change output. Consolidate: send all your ADA from this wallet back to itself in one tx (most wallets have a "Send Max" option), then retry.';
  if (m.includes('minimum output') || m.includes('too small'))
    return raw.split('\n')[0];
  if (m.includes('treasury not configured'))
    return raw.split('\n')[0];
  if (m.includes('no utxos') || m.includes('no utxo found'))
    return 'No UTxOs found — refresh and reconnect your wallet.';
  if (m.includes('validator crashed') || m.includes('exited prematurely'))
    return 'Smart contract rejected the transaction — the trade may already be in flight. Wait 30s and retry.';
  if (m.includes('network') || m.includes('fetch failed') || m.includes('econnrefused'))
    return 'Network error — check your connection and try again.';
  if (m.includes('script integrity'))
    return 'Script hash mismatch — reload the page and retry.';
  return `${op === 'buy' ? 'Buy' : 'Sell'} failed: ${raw.split('\n')[0].slice(0, 120)}`;
}

// ── Tx success banner ─────────────────────────────────────────────────────────

function TxBanner({ hash, onDismiss }: { hash: string; onDismiss: () => void }) {
  const explorerUrl = txExplorerUrl(hash);
  return (
    <div
      className="rounded-lg p-3 flex items-start justify-between gap-2"
      style={{ background: 'rgba(92, 224, 210, 0.08)', border: '1px solid rgba(92, 224, 210, 0.25)' }}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="text-xs font-semibold" style={{ color: 'var(--teal)' }}>Transaction submitted</p>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs truncate"
          style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
        >
          {hash.slice(0, 16)}…{hash.slice(-8)}
        </a>
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
  // a single 5-second poll.
  const { data: curve, isLoading: curveLoading } = useQuery({
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
  const [error,        setError]     = useState<string | null>(null);
  const [successTx,    setSuccessTx] = useState<string | null>(null);

  // ── Derived values ──────────────────────────────────────────────────────────

  const isBuy = tab === 'buy';

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
    if (sellPct !== null && tokenBalance) {
      // 100% sells the entire balance; others floor-divide
      return (tokenBalance * BigInt(sellPct)) / 100n;
    }
    const n = parseInt(sellRaw, 10);
    return Number.isFinite(n) && n > 0 ? BigInt(n) : 0n;
  })();

  const grossL     = curve && sellUnits > 0n
    ? quoteSellGross(curve.adaReserve, curve.tokenReserve, sellUnits) : 0n;
  const creatorFeeL = (grossL * BigInt(creatorFeeBps)) / 10000n;
  const netL        = grossL > PLATFORM_FEE + creatorFeeL
    ? grossL - PLATFORM_FEE - creatorFeeL : 0n;

  // Buy-side creator fee: same bps × ada_in (matches validate_buy on-chain).
  const creatorBuyFeeL = (buyAdaL * BigInt(creatorFeeBps)) / 10000n;

  const insufficientAda = buyAdaL > 0n && wallet && wallet.lovelace < buyAdaL + PLATFORM_FEE + creatorBuyFeeL + 2_000_000n;
  const insufficientTokens = sellUnits > 0n && tokenBalance !== undefined && sellUnits > tokenBalance;

  const buyDisabled  = submitting || !wallet || !buyAdaL || curveLoading || !!insufficientAda;
  const sellDisabled = submitting || !wallet || !sellUnits || curveLoading || !!insufficientTokens;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const switchTab = useCallback((t: 'buy' | 'sell') => {
    setTab(t); setError(null); setSuccessTx(null);
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
    setError(null);
  }

  function handleBuyInput(v: string) {
    setBuyAda(v); setBuyChip(null); setError(null);
  }

  function handleSellPct(pct: number) {
    if (sellPct === pct) {
      setSellPct(null); setSellRaw(''); setError(null);
      return;
    }
    setSellPct(pct);
    // Populate the input field with the calculated token amount so the user
    // sees the exact number they're selling and can edit it before submitting.
    if (tokenBalance && tokenBalance > 0n) {
      const amt = (tokenBalance * BigInt(pct)) / 100n;
      setSellRaw(amt.toString());
    } else {
      setSellRaw('');
    }
    setError(null);
  }

  function handleSellInput(v: string) {
    setSellRaw(v); setSellPct(null); setError(null);
  }

  async function handleBuy() {
    if (!walletApi || !curve || !buyAdaL) return;
    if (!TREASURY) { setError('Protocol treasury not configured — check NEXT_PUBLIC_TREASURY_ADDRESS'); return; }
    setSubmitting(true); setError(null); setSuccessTx(null);
    try {
      const { buyTokens } = await import('@/lib/cardano-tx');
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
      const res = await buyTokens(
        walletApi, snapshot, buyAdaL, DEFAULT_SLIPPAGE_BPS, creatorFeeBps,
        policyId, assetName, curveAddress, validatorCbor,
        treasuryBech32, creatorBech32, feeAccumulatorAddress,
      );
      setSuccessTx(res.txHash);
      setBuyAda(''); setBuyChip(null);
      invalidateCurve();
    } catch (e) {
      console.error('[trade] buy failed:', e);
      setError(friendlyError(e, 'buy'));
    } finally {
      setSubmitting(false);
    }
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
    if (!walletApi || !curve || !sellUnits) return;
    if (!TREASURY) { setError('Protocol treasury not configured — check NEXT_PUBLIC_TREASURY_ADDRESS'); return; }
    setSubmitting(true); setError(null); setSuccessTx(null);
    try {
      const { sellTokens } = await import('@/lib/cardano-tx');
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
      const res = await sellTokens(
        walletApi, snapshot, sellUnits, DEFAULT_SLIPPAGE_BPS, creatorFeeBps,
        policyId, assetName, curveAddress, validatorCbor,
        treasuryBech32, creatorBech32, feeAccumulatorAddress,
      );
      setSuccessTx(res.txHash);
      setSellRaw(''); setSellPct(null);
      invalidateCurve();
    } catch (e) {
      console.error('[trade] sell failed:', e);
      setError(friendlyError(e, 'sell'));
    } finally {
      setSubmitting(false);
    }
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
      {/* Success banner */}
      {successTx && <TxBanner hash={successTx} onDismiss={() => setSuccessTx(null)} />}

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

          {/* Inline error */}
          {error && (
            <p className="text-xs text-center" style={{ color: 'var(--lava-bright)' }}>
              {error}
            </p>
          )}
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
                  ? `${fmtTok(tokenBalance)} $${ticker}`
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
                    disabled={!tokenBalance || tokenBalance === 0n}
                  />
                ))}
              </div>
              {tokenBalance === 0n && (
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

          {/* Inline error */}
          {error && (
            <p className="text-xs text-center" style={{ color: 'var(--lava-bright)' }}>
              {error}
            </p>
          )}
          {disconnectedNote}
        </div>
      )}
    </div>
  );
}
