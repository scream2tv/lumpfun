'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

// Top 10 creator-fee earners leaderboard. Right-rail on /feed.
// Polls /api/top-earners every 60s — earners list shifts only as
// trades and sweeps confirm, so a tighter cadence isn't worth the
// Blockfrost calls (one /addresses/{addr}/total per accumulator).

interface Earner {
  creatorAddress: string;
  tokens:         Array<{ policyId: string; ticker: string }>;
  lifetime:       string;
  claimed:        string;
  unclaimed:      string;
}

interface ApiBody {
  earners: Earner[];
  total:   string;
}

function fmtAda(loveStr: string): string {
  const ada = Number(BigInt(loveStr || '0')) / 1_000_000;
  if (ada >= 1_000_000) return `${(ada / 1_000_000).toFixed(2)}M ₳`;
  if (ada >= 1_000)     return `${(ada / 1_000).toFixed(1)}K ₳`;
  if (ada >= 1)         return `${ada.toFixed(2)} ₳`;
  if (ada > 0)          return `${ada.toFixed(4)} ₳`;
  return '0 ₳';
}

function shortAddr(a: string): string {
  if (a.length <= 14) return a;
  return `${a.slice(0, 8)}…${a.slice(-4)}`;
}

export function TopEarners() {
  const { data, isLoading } = useQuery<ApiBody>({
    queryKey: ['top-earners'],
    queryFn: async () => {
      const res = await fetch('/api/top-earners', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const earners = data?.earners ?? [];
  const total   = data?.total ?? '0';
  const max     = earners[0] ? BigInt(earners[0].lifetime) : 0n;

  return (
    <aside
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex items-baseline justify-between">
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}
        >
          Top earners
        </h2>
        <span
          className="text-[10px]"
          style={{ color: 'var(--text-dim)' }}
        >
          creator fees
        </span>
      </div>

      {isLoading && earners.length === 0 ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse rounded-md"
              style={{ height: 28, background: 'var(--bg-elevated)' }}
            />
          ))}
        </div>
      ) : earners.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
          No fees earned yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {earners.map((e, i) => {
            const lifeBig = BigInt(e.lifetime);
            const pct     = max > 0n ? Number((lifeBig * 1000n) / max) / 10 : 0;
            const top     = e.tokens[0];
            return (
              <li key={e.creatorAddress} className="relative">
                <div
                  className="absolute inset-0 rounded-md"
                  style={{
                    background: 'rgba(92,224,210,0.08)',
                    width: `${Math.max(pct, 4)}%`,
                    transition: 'width 300ms',
                  }}
                  aria-hidden
                />
                <div className="relative flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-[11px] font-semibold tabular-nums w-4 text-center"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      {i + 1}
                    </span>
                    {top ? (
                      <Link
                        href={`/token/${top.policyId}`}
                        className="text-xs font-medium truncate"
                        style={{
                          color: 'var(--teal)',
                          fontFamily: 'var(--font-jetbrains), monospace',
                          textDecoration: 'none',
                        }}
                        title={`${e.tokens.map(t => '$' + t.ticker).join(', ')} — ${e.creatorAddress}`}
                      >
                        ${top.ticker}
                        {e.tokens.length > 1 && (
                          <span style={{ color: 'var(--text-dim)' }}>
                            {' '}+{e.tokens.length - 1}
                          </span>
                        )}
                      </Link>
                    ) : (
                      <span
                        className="text-xs truncate"
                        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
                      >
                        {shortAddr(e.creatorAddress)}
                      </span>
                    )}
                  </div>
                  <span
                    className="text-xs font-semibold tabular-nums shrink-0"
                    style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-jetbrains), monospace' }}
                  >
                    {fmtAda(e.lifetime)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div
        className="flex items-baseline justify-between pt-2 mt-1"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <span
          className="text-[11px] uppercase tracking-wider"
          style={{ color: 'var(--text-dim)' }}
        >
          Total generated
        </span>
        <span
          className="text-sm font-semibold tabular-nums"
          style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}
        >
          {fmtAda(total)}
        </span>
      </div>
    </aside>
  );
}
