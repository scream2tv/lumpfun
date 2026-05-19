import Link from 'next/link';
import { getRecentBlocks, type MidnightBlock, type MidnightTransaction } from '@/lib/midnight/indexer';

const VIOLET = '#a78bfa';
const NATIVE_TOKEN = '0000000000000000000000000000000000000000000000000000000000000000';

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

function formatNight(value: string): string {
  // native tNIGHT = 6 decimals
  try {
    const n = BigInt(value);
    const whole = n / 1_000_000n;
    const frac = n % 1_000_000n;
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
  } catch {
    return value;
  }
}

export default async function MidnightFeed() {
  let blocks: MidnightBlock[] | null = null;
  let error: string | null = null;
  try {
    blocks = await getRecentBlocks(10);
  } catch (e) {
    error = e instanceof Error ? e.message : 'unknown error';
  }

  // Pre-aggregate stats across the window.
  const txCount = blocks?.reduce((a, b) => a + b.transactions.length, 0) ?? 0;
  const contractTxCount = blocks?.reduce(
    (a, b) => a + b.transactions.filter(tx => tx.contractActions.length > 0).length,
    0,
  ) ?? 0;
  const unshieldedTxCount = blocks?.reduce(
    (a, b) => a + b.transactions.filter(tx => tx.unshieldedCreatedOutputs.length > 0).length,
    0,
  ) ?? 0;

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
        {/* Header */}
        <div className="flex items-baseline justify-between flex-wrap gap-3 mb-2">
          <h1
            style={{
              fontFamily: 'var(--font-outfit), system-ui, sans-serif',
              fontSize: 36,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-bright)',
            }}
          >
            Preprod activity
          </h1>
          <Link
            href="/midnight"
            style={{
              fontSize: 12,
              color: VIOLET,
              fontFamily: 'var(--font-mono)',
              textDecoration: 'none',
              opacity: 0.8,
            }}
          >
            ← /midnight
          </Link>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 28, maxWidth: 640 }}>
          Latest {blocks?.length ?? 0} blocks from the public v4 indexer, refreshed on every visit.
          LumpFun launches will appear here once the deploy route is wired.
        </p>

        {/* Summary stats */}
        {!error && blocks && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
              marginBottom: 24,
            }}
          >
            <Stat label="Head height" value={blocks[0]?.height.toString() ?? '—'} />
            <Stat label="Blocks in window" value={blocks.length.toString()} />
            <Stat label="Total txs" value={txCount.toString()} />
            <Stat label="Contract txs" value={contractTxCount.toString()} accent={VIOLET} />
            <Stat label="Unshielded txs" value={unshieldedTxCount.toString()} accent="#5ce0d2" />
          </div>
        )}

        {/* Block list */}
        {error ? (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 12,
              padding: 20,
              color: '#f87171',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
            }}
          >
            Indexer error: {error}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {blocks?.map(block => <BlockRow key={block.hash} block={block} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-mid)',
        borderRadius: 10,
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-outfit)',
          fontSize: 22,
          fontWeight: 600,
          color: accent ?? 'var(--text-bright)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BlockRow({ block }: { block: MidnightBlock }) {
  const hasContract = block.transactions.some(tx => tx.contractActions.length > 0);
  return (
    <section
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${hasContract ? `${VIOLET}55` : 'var(--border-mid)'}`,
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-bright)' }}>
            #{block.height}
          </span>
          {hasContract && (
            <span
              style={{
                fontSize: 10,
                color: VIOLET,
                background: `${VIOLET}1a`,
                border: `1px solid ${VIOLET}33`,
                padding: '1px 6px',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
              }}
            >
              CONTRACT
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {block.transactions.length} tx
          </span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {relTime(block.timestamp)}
        </span>
      </header>

      {block.transactions.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {block.transactions.slice(0, 5).map(tx => (
            <TxRow key={tx.hash} tx={tx} />
          ))}
          {block.transactions.length > 5 && (
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              + {block.transactions.length - 5} more tx
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function TxRow({ tx }: { tx: MidnightTransaction }) {
  const nativeOuts = tx.unshieldedCreatedOutputs.filter(o => o.tokenType === NATIVE_TOKEN);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
        <span style={{ color: 'var(--text-dim)' }}>tx</span>
        <code style={{ color: 'var(--text)' }}>{truncMid(tx.hash)}</code>
        {tx.__typename === 'SystemTransaction' && (
          <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>(system)</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {tx.contractActions.length > 0 && (
          <span style={{ color: VIOLET }}>{tx.contractActions.length} action(s)</span>
        )}
        {nativeOuts.length > 0 && (
          <span style={{ color: '#5ce0d2' }}>
            +{nativeOuts.length === 1
              ? `${formatNight(nativeOuts[0].value)} tNIGHT`
              : `${nativeOuts.length} outs`}
          </span>
        )}
      </div>
    </div>
  );
}
