import Link from 'next/link';
import Image from 'next/image';
import type { TokenInfo } from '@/lib/types';

// "Best of the Bunker" — hero card on the feed highlighting the project
// closest to graduation. Picks whichever non-graduated token has the
// highest bondedPct among those at or above 50%. Falls back to LUG (the
// flagship test launch) until any token clears the 50% gate.

const FALLBACK_TICKER = 'LUG';
const KING_THRESHOLD  = 50;

function pickKing(tokens: TokenInfo[]): TokenInfo | null {
  const live      = tokens.filter(t => !t.graduated);
  const qualified = live
    .filter(t => t.bondedPct >= KING_THRESHOLD)
    .sort((a, b) => b.bondedPct - a.bondedPct);
  if (qualified[0]) return qualified[0];
  const fallback = live.find(t => t.ticker.toUpperCase() === FALLBACK_TICKER);
  return fallback ?? null;
}

function fmtMcap(ada: number): string {
  if (ada >= 1_000_000) return `${(ada / 1_000_000).toFixed(2)}M`;
  if (ada >= 1_000)     return `${(ada / 1_000).toFixed(1)}K`;
  return ada.toFixed(0);
}

export function BestOfBunker({ tokens }: { tokens: TokenInfo[] }) {
  const king = pickKing(tokens);
  if (!king) return null;

  const isQualified = king.bondedPct >= KING_THRESHOLD;
  const bondedRounded = Math.round(king.bondedPct * 10) / 10;

  return (
    <Link
      href={`/token/${king.policyId}?asset=${king.assetName}`}
      className="block mb-4 group"
      style={{ textDecoration: 'none' }}
    >
      <div
        className="relative overflow-hidden rounded-2xl px-4 sm:px-6 py-4 sm:py-5 flex items-center gap-4"
        style={{
          background:
            'radial-gradient(120% 220% at 0% 0%, rgba(255,107,53,0.18), transparent 55%), ' +
            'radial-gradient(120% 220% at 100% 100%, rgba(92,224,210,0.18), transparent 55%), ' +
            'var(--bg-card)',
          border: '1px solid rgba(255,107,53,0.35)',
          boxShadow: '0 0 32px rgba(255,107,53,0.12)',
        }}
      >
        {/* Badge */}
        <span
          aria-hidden
          className="absolute top-3 left-3 sm:top-3 sm:left-5 text-[10px] uppercase tracking-[0.25em] font-semibold px-2 py-0.5 rounded-md"
          style={{
            color: '#fff',
            background: 'linear-gradient(90deg,#ff6b35,#e85a2a)',
            fontFamily: 'var(--font-outfit)',
          }}
        >
          Best of the Bunker
        </span>

        {/* Avatar */}
        <div
          className="shrink-0 relative overflow-hidden rounded-xl mt-5 sm:mt-3"
          style={{
            width: 72,
            height: 72,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-mid)',
          }}
        >
          {king.imageUri ? (
            <Image
              src={king.imageUri.replace('ipfs://', 'https://ipfs.io/ipfs/')}
              alt={king.name}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div
              className="flex h-full items-center justify-center font-bold"
              style={{ color: 'var(--lava-bright)', fontFamily: 'var(--font-outfit)', fontSize: 28 }}
            >
              {king.ticker[0]}
            </div>
          )}
        </div>

        {/* Identity + headline stats */}
        <div className="min-w-0 flex-1 mt-5 sm:mt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-semibold text-lg sm:text-xl truncate"
              style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}
            >
              {king.name}
            </span>
            <span
              className="text-sm"
              style={{ color: 'var(--lava-bright)', fontFamily: 'var(--font-jetbrains), monospace' }}
            >
              ${king.ticker}
            </span>
            {!isQualified && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  color: 'var(--text-dim)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                showcase · awaiting first 50% bond
              </span>
            )}
          </div>

          {king.description && (
            <p
              className="text-xs sm:text-sm line-clamp-1 mt-0.5"
              style={{ color: 'var(--text-dim)' }}
            >
              {king.description}
            </p>
          )}

          <div className="flex items-center gap-4 sm:gap-5 mt-2 flex-wrap">
            <Metric label="Bonded" value={`${bondedRounded.toFixed(1)}%`} accent />
            <Metric label="Mcap"   value={`${fmtMcap(king.marketCapAda)} ₳`} />
            <Metric
              label="Price"
              value={`${(Number(king.priceLovelace) / 1_000_000).toFixed(6)} ₳`}
              hideOnMobile
            />
          </div>
        </div>

        {/* CTA */}
        <div className="hidden sm:flex shrink-0 mt-3 self-start">
          <span
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-transform group-hover:scale-105"
            style={{
              background: 'var(--lava-bright)',
              color: '#fff',
              fontFamily: 'var(--font-outfit)',
              boxShadow: '0 0 18px rgba(232,90,42,0.35)',
            }}
          >
            Trade →
          </span>
        </div>
      </div>
    </Link>
  );
}

function Metric({
  label, value, accent, hideOnMobile,
}: { label: string; value: string; accent?: boolean; hideOnMobile?: boolean }) {
  return (
    <div className={`flex flex-col ${hideOnMobile ? 'hidden sm:flex' : ''}`}>
      <span
        className="text-[10px] uppercase tracking-wider"
        style={{ color: 'var(--text-dim)' }}
      >
        {label}
      </span>
      <span
        className="text-sm font-semibold tabular-nums"
        style={{
          color: accent ? 'var(--lava-bright)' : 'var(--text)',
          fontFamily: 'var(--font-jetbrains), monospace',
        }}
      >
        {value}
      </span>
    </div>
  );
}
