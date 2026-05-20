import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLaunch } from '@/lib/midnight/launches';
import { fetchRecentTrades, type Trade } from '@/lib/midnight/trades';
import { CopyButton } from '@/components/copy-button';

const VIOLET = '#a78bfa';

function relTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function truncMid(s: string, head = 8, tail = 6): string {
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** Format native tNIGHT atoms (6 decimals) as a short tNIGHT string. */
function fmtNight(atoms: string): string {
  try {
    const n = BigInt(atoms);
    const whole = n / 1_000_000n;
    const frac = n % 1_000_000n;
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
  } catch {
    return atoms;
  }
}

export default async function MidnightLaunchPage(
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const launch = getLaunch(address, 'preprod');
  if (!launch) notFound();

  let trades: Trade[] = [];
  let tradesError: string | null = null;
  try {
    trades = await fetchRecentTrades(launch.address, 25);
  } catch (e) {
    tradesError = e instanceof Error ? e.message : 'unknown error';
  }

  const buyCount = trades.filter(t => t.side === 'buy').length;
  const sellCount = trades.filter(t => t.side === 'sell').length;
  const totalNight = trades.reduce((a, t) => a + BigInt(t.amountNight || '0'), 0n);

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 64px)',
        background: 'var(--bg-deep)',
        backgroundImage:
          `radial-gradient(ellipse at top, ${VIOLET}14, transparent 55%),` +
          'radial-gradient(ellipse at bottom, rgba(92,224,210,0.04), transparent 55%)',
        padding: '40px 16px',
      }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Breadcrumb */}
        <Link
          href="/midnight"
          style={{ fontSize: 12, color: VIOLET, fontFamily: 'var(--font-mono)', textDecoration: 'none', opacity: 0.8 }}
        >
          ← /midnight
        </Link>

        {/* Header */}
        <div className="flex items-baseline gap-3 flex-wrap mt-4 mb-2">
          <h1
            style={{
              fontFamily: 'var(--font-outfit), system-ui, sans-serif',
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-bright)',
            }}
          >
            {launch.name}
          </h1>
          <span
            style={{
              fontSize: 14,
              color: VIOLET,
              fontFamily: 'var(--font-mono)',
              background: `${VIOLET}1a`,
              border: `1px solid ${VIOLET}33`,
              padding: '2px 10px',
              borderRadius: 999,
              letterSpacing: '0.04em',
            }}
          >
            ${launch.symbol}
          </span>
          {launch.demo && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
              DEMO · PREPROD
            </span>
          )}
        </div>

        {/* Contract row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
            {launch.address}
          </code>
          <CopyButton text={launch.address} />
        </div>

        {/* Stat band */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
            marginBottom: 28,
          }}
        >
          <Stat label="Base price" value={`${launch.curve.basePriceNight}`} unit="atoms" />
          <Stat label="Slope" value={launch.curve.slopeNight} unit="atoms/tok" />
          <Stat label="Max supply" value={Number(launch.curve.maxSupply).toLocaleString()} />
          <Stat label="Fee" value={`${launch.fees.feeBps / 100}%`} accent={VIOLET} />
          <Stat label="Trades shown" value={trades.length.toString()} accent="#5ce0d2" />
        </div>

        {/* Trade activity summary */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 28,
          }}
        >
          <Stat label="Recent buys" value={buyCount.toString()} accent="#22c55e" />
          <Stat label="Recent sells" value={sellCount.toString()} accent="#f87171" />
          <Stat label="Total native moved" value={`${fmtNight(totalNight.toString())} tNIGHT`} small />
        </div>

        {/* Trade feed */}
        <h2
          style={{
            fontFamily: 'var(--font-outfit)',
            fontSize: 13,
            color: 'var(--text-dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 12,
          }}
        >
          Recent activity
        </h2>

        {tradesError ? (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 12,
              padding: 16,
              color: '#f87171',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            Trades feed unavailable: {tradesError}
          </div>
        ) : trades.length === 0 ? (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px dashed var(--border-mid)',
              borderRadius: 12,
              padding: 24,
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontSize: 13,
            }}
          >
            No trades in the last 1,000 blocks (~100 min). The agent runner will populate this once it&apos;s online.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {trades.map(t => <TradeRow key={t.txHash} t={t} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label, value, unit, accent, small,
}: { label: string; value: string; unit?: string; accent?: string; small?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)', borderRadius: 10, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: small ? 'var(--font-mono)' : 'var(--font-outfit)', fontSize: small ? 13 : 20, fontWeight: 600, color: accent ?? 'var(--text-bright)' }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{unit}</span>}
      </div>
    </div>
  );
}

function TradeRow({ t }: { t: Trade }) {
  const sideColor = t.side === 'buy' ? '#22c55e' : t.side === 'sell' ? '#f87171' : 'var(--text-dim)';
  const sideLabel = t.side === 'buy' ? 'BUY' : t.side === 'sell' ? 'SELL' : t.entryPoint.toUpperCase();
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-mid)',
        borderRadius: 10,
        padding: '10px 14px',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        alignItems: 'center',
        gap: 12,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
      }}
    >
      <span
        style={{
          color: sideColor,
          background: `${sideColor}1a`,
          padding: '2px 8px',
          borderRadius: 4,
          letterSpacing: '0.06em',
          fontSize: 10,
        }}
      >
        {sideLabel}
      </span>
      <code style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        tx {truncMid(t.txHash)}
      </code>
      <span style={{ color: 'var(--text-bright)' }}>
        {fmtNight(t.amountNight)} tNIGHT
      </span>
      <span style={{ color: 'var(--text-dim)' }}>
        {relTime(t.timestamp)}
      </span>
    </div>
  );
}
