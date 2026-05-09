import Link from 'next/link';
import { Suspense } from 'react';
import { TokenCard } from '@/components/token-card';
import { BestOfBunker } from './best-of-bunker';
import { TopEarners } from './top-earners';
import { fetchTokenList, fetchTokenInfo } from '@/lib/blockfrost';
import type { SortMode, TokenInfo } from '@/lib/types';

async function loadTokens(): Promise<TokenInfo[]> {
  const list  = await fetchTokenList();
  const infos = await Promise.all(list.map(m => fetchTokenInfo(m)));
  return infos.filter((t): t is TokenInfo => t !== null);
}

function sortTokens(tokens: TokenInfo[], sort: SortMode): TokenInfo[] {
  if (sort === 'trending')
    return [...tokens].sort((a, b) => b.bondedPct - a.bondedPct);
  if (sort === 'graduating')
    return [...tokens].filter(t => t.bondedPct >= 80).sort((a, b) => b.bondedPct - a.bondedPct);
  return [...tokens].sort((a, b) => new Date(b.launchedAt).getTime() - new Date(a.launchedAt).getTime());
}

async function FeedBody({ sort }: { sort: SortMode }) {
  const tokens = await loadTokens();

  if (tokens.length === 0) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
        <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
          <p className="text-base mb-6" style={{ color: 'var(--text-dim)' }}>
            No tokens yet — be the first.
          </p>
          <Link
            href="/create"
            style={{
              padding: '10px 24px',
              background: 'var(--teal)',
              color: 'var(--bg-deep)',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 14,
              fontFamily: 'var(--font-outfit)',
              boxShadow: '0 0 24px rgba(92,224,210,0.4)',
              textDecoration: 'none',
            }}
          >
            Launch the first token →
          </Link>
        </div>
      </div>
    );
  }

  const sorted = sortTokens(tokens, sort);

  return (
    <>
      <BestOfBunker tokens={tokens} />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
        {sorted.map(t => (
          <TokenCard key={`${t.policyId}${t.assetName}`} token={t} />
        ))}
      </div>
    </>
  );
}

function Skeleton() {
  return (
    <>
      <div
        className="animate-pulse rounded-2xl mb-4"
        style={{ height: 120, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
      />
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl"
            style={{ height: 156, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          />
        ))}
      </div>
    </>
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort = 'new' } = await searchParams;
  const sortMode = (['new', 'trending', 'graduating'].includes(sort) ? sort : 'new') as SortMode;

  const tabs: Array<{ key: SortMode; label: string }> = [
    { key: 'new',        label: 'New' },
    { key: 'trending',   label: 'Trending' },
    { key: 'graduating', label: 'Graduating' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      {/* Compact header row */}
      <div className="flex items-center justify-between mb-4">
        <div
          className="flex gap-px"
          style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 3 }}
        >
          {tabs.map(tab => {
            const active = sortMode === tab.key;
            return (
              <Link
                key={tab.key}
                href={`/feed?sort=${tab.key}`}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--text-bright)' : 'var(--text-dim)',
                  background: active ? 'var(--bg-card)' : 'transparent',
                  fontFamily: 'var(--font-outfit)',
                  textDecoration: 'none',
                  transition: 'all 150ms',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <Link
          href="/create"
          style={{
            height: 36,
            padding: '0 16px',
            background: 'var(--teal)',
            color: 'var(--bg-deep)',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 13,
            fontFamily: 'var(--font-outfit)',
            display: 'inline-flex',
            alignItems: 'center',
            boxShadow: '0 0 16px rgba(92,224,210,0.3)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          + Launch
        </Link>
      </div>

      {/* Two-column layout: feed on the left, leaderboard rail on the
          right. Stacks below the feed on screens narrower than lg so we
          don't crowd cards on mobile. */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:items-start">
        <div className="flex-1 min-w-0">
          <Suspense fallback={<Skeleton />}>
            <FeedBody sort={sortMode} />
          </Suspense>
        </div>
        <div className="lg:w-72 lg:shrink-0 lg:sticky lg:top-4">
          <TopEarners />
        </div>
      </div>
    </div>
  );
}
