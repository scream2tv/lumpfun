import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { LiveStats } from './live-stats';
import { CopyButton } from '@/components/copy-button';
import { TradePanel } from './trade-panel';
import { VestingClaimPanel } from './vesting-claim';
import { fetchTokenList, fetchTokenInfo, fetchHolderCount, fetchVestingBalance } from '@/lib/blockfrost';
import { PriceChart } from './price-chart';
import { TradesHolders } from './trades-holders';
import { SocialLinks } from '@/lib/social-links';

function truncPolicy(id: string) {
  if (!id) return '';
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60)        return `${sec}s ago`;
  if (sec < 3600)      return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400)     return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 30)  return `${Math.floor(sec / 86400)}d ago`;
  if (sec < 86400 * 365) return `${Math.floor(sec / (86400 * 30))}mo ago`;
  return `${Math.floor(sec / (86400 * 365))}y ago`;
}

function MetricCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <p
        className="text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}
      >
        {label}
      </p>
      <p
        className="font-semibold text-sm tabular-nums truncate"
        style={{ color: accent ?? 'var(--text-bright)', fontFamily: 'var(--font-jetbrains), monospace' }}
      >
        {value}
      </p>
    </div>
  );
}

async function TokenDetail({ policyId, assetName }: { policyId: string; assetName: string }) {
  const list = await fetchTokenList();
  const meta = list.find(t => t.policyId === policyId && t.assetName === assetName);
  if (!meta) notFound();

  const token = await fetchTokenInfo(meta);
  if (!token) notFound();

  const assetUnit = `${token.policyId}${token.assetName}`;
  const holderCount = await fetchHolderCount(assetUnit).catch(() => 0);
  // Tokens currently locked at the per-launch vesting script (0 if creator
  // skipped vesting or already claimed). Shown as its own metric so the
  // holders list isn't polluted with the script address.
  const vestingBalance = token.vestingAddress
    ? await fetchVestingBalance(token.vestingAddress, assetUnit).catch(() => 0n)
    : null;

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      {/*
        Mobile: stacks top-to-bottom (header → trade panel → chart/stats)
        Desktop: 2/3 left (chart + stats) + 1/3 right (trade panel)
        Trade panel is placed first in DOM but visually right on desktop via CSS order.
      */}
      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-6">

        {/* Trade panel — first in DOM = first on mobile, sticky on desktop */}
        <div className="lg:col-span-1 lg:row-span-3 order-first lg:order-last">
          <div className="lg:sticky lg:top-20">
            {/* Token header (compact, mobile-visible above panel) */}
            <div className="flex items-center gap-3 mb-3">
              <div
                className="relative shrink-0 overflow-hidden rounded-xl"
                style={{
                  width: 48, height: 48,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-mid)',
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
                    className="flex h-full items-center justify-center text-xl font-bold"
                    style={{ color: 'var(--teal)', fontFamily: 'var(--font-outfit)' }}
                  >
                    {token.ticker[0]}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-bold" style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}>
                    {token.name}
                  </h1>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-mono"
                    style={{ background: 'var(--teal-muted)', color: 'var(--teal)', border: '1px solid rgba(92,224,210,.2)' }}
                  >
                    ${token.ticker}
                  </span>
                  {token.graduated && (
                    <span className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(212,146,42,.15)', color: 'var(--amber-bright)', border: '1px solid rgba(212,146,42,.3)' }}>
                      Graduated
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className="text-xs"
                    style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
                  >
                    {truncPolicy(token.policyId)}
                  </span>
                  <CopyButton text={token.policyId} label="" />
                </div>
                {token.description && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-dim)', lineHeight: 1.45 }}>
                    {token.description}
                  </p>
                )}
              </div>
              <SocialLinks
                website={token.website}
                twitter={token.twitter}
                telegram={token.telegram}
                discord={token.discord}
              />
            </div>

            {token.vestingAddress && token.vestingValidatorCbor && token.vestingUnlockMs && (
              <VestingClaimPanel
                policyId={token.policyId}
                assetName={token.assetName}
                creatorAddress={token.creatorAddress}
                vestingAddress={token.vestingAddress}
                vestingValidatorCbor={token.vestingValidatorCbor}
                vestingUnlockMs={token.vestingUnlockMs}
                vestingClaimedTxHash={token.vestingClaimedTxHash}
              />
            )}

            <TradePanel
              policyId={token.policyId}
              assetName={token.assetName}
              curveAddress={token.curveAddress}
              creatorAddress={token.creatorAddress}
              validatorCbor={token.validatorCbor}
              ticker={token.ticker}
              creatorFeeBps={token.creatorFeeBps}
            />
          </div>
        </div>

        {/* Left: stats + chart (desktop) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Description now lives in the right-column header next to the image. */}

          {/* Inline metrics row + bonding progress — live-updated on the
              client via /api/curve polling. SSR seeds the initial values
              so the page paints with real numbers, then takes over. */}
          <LiveStats
            curveAddress={token.curveAddress}
            assetUnit={assetUnit}
            initialAdaReserve={token.adaReserve.toString()}
            initialTokenReserve={token.tokenReserve.toString()}
            holderCount={holderCount}
            createdRel={relTime(token.launchedAt)}
            vestingBalance={vestingBalance}
            ticker={token.ticker}
            graduated={token.graduated}
          />

          {/* Price chart */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <h2 className="text-xs font-semibold mb-3 uppercase tracking-wide"
              style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}>
              Price chart
            </h2>
            <PriceChart curveAddress={token.curveAddress} assetUnit={assetUnit} />
          </div>

          {/* Trades / Holders */}
          <TradesHolders
            curveAddress={token.curveAddress}
            creatorAddress={token.creatorAddress}
            vestingAddress={token.vestingAddress}
            assetUnit={assetUnit}
            ticker={token.ticker}
          />

        </div>
      </div>
    </div>
  );
}

export default async function TokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ policyId: string }>;
  searchParams: Promise<{ asset?: string }>;
}) {
  const { policyId } = await params;
  const { asset = '' } = await searchParams;

  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className={`animate-pulse rounded-xl ${i === 0 ? 'lg:col-span-1 lg:row-span-3' : 'lg:col-span-2'}`}
              style={{ height: i === 0 ? 480 : 120, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
            />
          ))}
        </div>
      }
    >
      <TokenDetail policyId={policyId} assetName={asset} />
    </Suspense>
  );
}
