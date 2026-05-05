import Link from 'next/link';
import Image from 'next/image';
import { BondingProgress } from './bonding-progress';
import type { TokenInfo } from '@/lib/types';

function mcap(ada: number): string {
  if (ada >= 1_000_000) return `${(ada / 1_000_000).toFixed(1)}M`;
  if (ada >= 1_000)     return `${(ada / 1_000).toFixed(1)}K`;
  return ada.toFixed(0);
}

function trunc(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function TokenCard({ token }: { token: TokenInfo }) {
  return (
    <Link
      href={`/token/${token.policyId}?asset=${token.assetName}`}
      className="lf-card group flex flex-col gap-2.5 p-3 cursor-pointer"
    >
      {/* Top row: avatar + name block */}
      <div className="flex items-start gap-2.5">
        <div
          className="relative shrink-0 overflow-hidden rounded-lg"
          style={{
            width: 44,
            height: 44,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {token.imageUri ? (
            <Image
              src={token.imageUri.replace('ipfs://', 'https://ipfs.io/ipfs/')}
              alt={token.name}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div
              className="flex h-full items-center justify-center font-bold text-base"
              style={{ color: 'var(--teal)', fontFamily: 'var(--font-outfit)' }}
            >
              {token.ticker[0]}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="font-semibold text-sm truncate"
              style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}
            >
              {token.name}
            </span>
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}
            >
              ${token.ticker}
            </span>
            {token.graduated && (
              <span
                className="text-xs px-1 py-px rounded"
                style={{ background: 'rgba(212,146,42,.15)', color: 'var(--amber-bright)', border: '1px solid rgba(212,146,42,.3)' }}
              >
                🎓
              </span>
            )}
          </div>
          {token.description && (
            <p className="text-xs line-clamp-1 mt-0.5" style={{ color: 'var(--text-dim)' }}>
              {token.description}
            </p>
          )}
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
            by{' '}
            <span style={{ color: 'var(--text)', fontFamily: 'var(--font-jetbrains), monospace' }}>
              {trunc(token.creatorAddress)}
            </span>
          </p>
        </div>
      </div>

      {/* Bonding bar */}
      <BondingProgress bondedPct={token.bondedPct} graduated={token.graduated} />

      {/* Bottom stats */}
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
          mcap{' '}
          <span className="font-semibold" style={{ color: 'var(--text)' }}>
            {mcap(token.marketCapAda)} ₳
          </span>
        </span>
        <span
          className="text-xs tabular-nums"
          style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
        >
          {(Number(token.priceLovelace) / 1_000_000).toFixed(6)} ₳
        </span>
      </div>
    </Link>
  );
}
