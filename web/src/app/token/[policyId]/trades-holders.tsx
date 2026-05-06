'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TradeEntry } from '@/app/api/trades/route';
import type { HolderEntry } from '@/app/api/holders/route';
import { txExplorerUrl, addressExplorerUrl } from '@/lib/utils';

function truncAddr(addr: string) {
  if (!addr || addr === 'unknown') return '—';
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function fmtAda(lovelaceStr: string) {
  return (Number(lovelaceStr) / 1_000_000).toFixed(2);
}

function fmtTokens(raw: string) {
  return Number(raw).toLocaleString();
}

function relTime(blockTime: number): string {
  const diff = Math.floor(Date.now() / 1000 - blockTime);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function fetchTrades(curveAddress: string, assetUnit: string): Promise<TradeEntry[]> {
  const res = await fetch(`/api/trades?address=${encodeURIComponent(curveAddress)}&asset=${encodeURIComponent(assetUnit)}`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchHolders(assetUnit: string): Promise<HolderEntry[]> {
  const res = await fetch(`/api/holders?asset=${encodeURIComponent(assetUnit)}`);
  if (!res.ok) return [];
  return res.json();
}

function DevBadge() {
  return (
    <span
      className="ml-1.5 px-1.5 py-px rounded text-[9px] uppercase tracking-wider font-semibold"
      style={{
        background: 'rgba(212,146,42,0.15)',
        color: 'var(--amber-bright)',
        border: '1px solid rgba(212,146,42,0.3)',
        fontFamily: 'var(--font-outfit), system-ui, sans-serif',
      }}
    >
      Dev
    </span>
  );
}

function TradesTable({ curveAddress, creatorAddress, assetUnit, ticker }: { curveAddress: string; creatorAddress: string; assetUnit: string; ticker: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['trades', curveAddress, assetUnit],
    queryFn: () => fetchTrades(curveAddress, assetUnit),
    refetchInterval: 10_000,
  });

  if (isLoading) return <SkeletonRows />;
  if (data.length === 0) return <Empty msg="No trades yet." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {['Type', 'ADA', `$${ticker}`, 'Trader', 'Time', ''].map(h => (
              <th
                key={h}
                className="pb-2 text-left font-semibold"
                style={{ color: 'var(--text-dim)', paddingRight: 12 }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(t => {
            const isBuy = t.type === 'buy';
            const typeColor = isBuy ? 'var(--teal)' : 'var(--lava)';
            return (
              <tr
                key={t.txHash}
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <td className="py-2 pr-3 font-semibold" style={{ color: typeColor }}>
                  {isBuy ? 'Buy' : 'Sell'}
                </td>
                <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text)', fontFamily: 'var(--font-jetbrains), monospace' }}>
                  {fmtAda(t.adaDelta)}
                </td>
                <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text)', fontFamily: 'var(--font-jetbrains), monospace' }}>
                  {fmtTokens(t.tokenDelta)}
                </td>
                <td className="py-2 pr-3" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}>
                  <a
                    href={addressExplorerUrl(t.trader)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                  >
                    {truncAddr(t.trader)}
                    {t.trader === creatorAddress && <DevBadge />}
                  </a>
                </td>
                <td className="py-2 pr-3" style={{ color: 'var(--text-dim)' }}>
                  {relTime(t.blockTime)}
                </td>
                <td className="py-2">
                  <a
                    href={txExplorerUrl(t.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View on Cardanoscan"
                    title="View on Cardanoscan"
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 22, height: 22, borderRadius: 4,
                      color: 'var(--text-dim)', textDecoration: 'none',
                      transition: 'color 120ms, background 120ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--teal)'; e.currentTarget.style.background = 'rgba(92,224,210,0.08)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HoldersTable({ assetUnit, curveAddress, creatorAddress, vestingAddress }: { assetUnit: string; curveAddress: string; creatorAddress: string; vestingAddress?: string }) {
  const { data: raw = [], isLoading } = useQuery({
    queryKey: ['holders', assetUnit],
    queryFn: () => fetchHolders(assetUnit),
    refetchInterval: 60_000,
  });

  // Hide the vesting script address from the holders list — it has its own
  // "Vested" metric in the page header. The bonding curve address stays in
  // the list (labeled "Bonding Curve") so users can see its share visibly.
  // Then rank descending by quantity so the largest holders sit at the top.
  const filtered = vestingAddress
    ? raw.filter(h => h.address !== vestingAddress)
    : raw;
  const data = [...filtered].sort((a, b) => {
    const aq = BigInt(a.quantity);
    const bq = BigInt(b.quantity);
    return aq > bq ? -1 : aq < bq ? 1 : 0;
  });

  if (isLoading) return <SkeletonRows />;
  if (data.length === 0) return <Empty msg="No holder data available." />;

  const totalTokens = data.reduce((sum, h) => sum + BigInt(h.quantity), 0n);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {['#', 'Address', 'Amount', 'Share'].map(h => (
              <th
                key={h}
                className="pb-2 text-left font-semibold"
                style={{ color: 'var(--text-dim)', paddingRight: 12 }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((h, i) => {
            const sharePct = totalTokens > 0n
              ? (Number(BigInt(h.quantity) * 10000n / totalTokens) / 100).toFixed(2)
              : '0.00';
            return (
              <tr
                key={h.address}
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text-dim)' }}>
                  {i + 1}
                </td>
                <td className="py-2 pr-3" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}>
                  <a
                    href={addressExplorerUrl(h.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'inherit', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
                  >
                    {h.address === curveAddress
                      ? <span style={{ color: 'var(--teal)', fontFamily: 'var(--font-outfit), system-ui, sans-serif' }}>Bonding Curve</span>
                      : <>
                          {truncAddr(h.address)}
                          {h.address === creatorAddress && <DevBadge />}
                        </>}
                  </a>
                </td>
                <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text)', fontFamily: 'var(--font-jetbrains), monospace' }}>
                  {Number(h.quantity).toLocaleString()}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1 rounded-full"
                      style={{
                        width: `${Math.max(parseFloat(sharePct), 1)}%`,
                        maxWidth: 80,
                        background: 'var(--teal)',
                        opacity: 0.7,
                      }}
                    />
                    <span style={{ color: 'var(--text-dim)' }}>{sharePct}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-2 py-2">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="h-6 rounded animate-pulse"
          style={{ background: 'var(--bg-elevated)', opacity: 0.6 }}
        />
      ))}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <p className="py-6 text-center text-xs" style={{ color: 'var(--text-dim)' }}>{msg}</p>
  );
}

export function TradesHolders({
  curveAddress,
  creatorAddress,
  vestingAddress,
  assetUnit,
  ticker,
}: {
  curveAddress: string;
  creatorAddress: string;
  vestingAddress?: string;
  assetUnit: string;
  ticker: string;
}) {
  const [tab, setTab] = useState<'trades' | 'holders'>('trades');

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
    >
      {/* Tab header */}
      <div className="flex gap-3">
        {(['trades', 'holders'] as const).map(t => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-outfit), system-ui, sans-serif',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                paddingBottom: 4,
                borderBottom: active ? '2px solid var(--teal)' : '2px solid transparent',
                color: active ? 'var(--text)' : 'var(--text-dim)',
                transition: 'color 150ms, border-color 150ms',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === 'trades'
        ? <TradesTable curveAddress={curveAddress} creatorAddress={creatorAddress} assetUnit={assetUnit} ticker={ticker} />
        : <HoldersTable assetUnit={assetUnit} curveAddress={curveAddress} creatorAddress={creatorAddress} vestingAddress={vestingAddress} />
      }
    </div>
  );
}
