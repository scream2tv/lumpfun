import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { LiveStats } from './live-stats';
import { CopyButton } from '@/components/copy-button';
import { TradePanel } from './trade-panel';
import { VestingClaimPanel } from './vesting-claim';
import { CreatorFeesPanel } from './fees-claim';
import { PendingOrders } from './pending-orders';
import { fetchTokenList, fetchTokenInfo, fetchHolderCount, fetchVestingBalance, fetchFeeAccumulatorStats } from '@/lib/blockfrost';
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
  // Strict match first; if the asset query was stripped (some mobile wallet
  // webviews drop search params on return navigation), fall back to the
  // first registry row with the same policyId — that's still uniquely the
  // launched token, since each launch has a one-shot policy.
  const meta =
    list.find(t => t.policyId === policyId && t.assetName === assetName) ??
    list.find(t => t.policyId === policyId);
  if (!meta) notFound();

  const token = await fetchTokenInfo(meta);
  if (!token) notFound();

  const assetUnit = `${token.policyId}${token.assetName}`;
  const holderCount = await fetchHolderCount(assetUnit).catch(() => 0);
  // Tokens currently locked at the per-launch vesting script (0 if creator
  // skipped vesting or already claimed). Shown as its own metric so the
  // holders list isn't polluted with the script address.
  // Vested metric sums every active position — launch lockup plus any
  // creator-added re-vest positions. Each address is queried independently
  // (its own per-launch script). null only when there are no positions at all.
  const vestingAddresses = [
    ...(token.vestingAddress ? [token.vestingAddress] : []),
    ...((token.extraVestings ?? []).map(v => v.address)),
  ];
  const vestingBalance = vestingAddresses.length === 0
    ? null
    : (await Promise.all(
        vestingAddresses.map(addr => fetchVestingBalance(addr, assetUnit).catch(() => 0n)),
      )).reduce<bigint>((sum, b) => sum + (b ?? 0n), 0n);

  // Creator fee accumulator stats (only set on tokens launched after the
  // accumulator pattern shipped). Server-renders an initial split of
  // unclaimed (still in script) vs claimed (already swept) lovelace; the
  // client panel polls every 15s for live updates as trades land.
  const feeAccumulatorStats = token.feeAccumulatorAddress
    ? await fetchFeeAccumulatorStats(token.feeAccumulatorAddress).catch(() => ({ unclaimed: 0n, claimed: 0n, lifetime: 0n }))
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

            {/* Public stat: creator fees collected at the per-launch
                accumulator. The Claim button only renders for the creator. */}
            {token.feeAccumulatorAddress && token.feeAccumulatorValidatorCbor && (
              <CreatorFeesPanel
                policyId={token.policyId}
                creatorAddress={token.creatorAddress}
                feeAccumulatorAddress={token.feeAccumulatorAddress}
                feeAccumulatorValidatorCbor={token.feeAccumulatorValidatorCbor}
                initialUnclaimed={(feeAccumulatorStats?.unclaimed ?? 0n).toString()}
                initialClaimed={(feeAccumulatorStats?.claimed ?? 0n).toString()}
                initialClaimedTxHash={token.feeAccumulatorClaimedTxHash}
              />
            )}

            {/* Compose every active vesting position: the launch lockup
                (if the creator picked one) plus any extras from re-vest. */}
            {(() => {
              const positions: Array<{
                address: string;
                validatorCbor: string;
                unlockMs: number;
                claimedTxHash?: string;
                source?: 'launch' | 'extra';
                isExtra?: boolean;
              }> = [];
              if (token.vestingAddress && token.vestingValidatorCbor && token.vestingUnlockMs) {
                positions.push({
                  address:       token.vestingAddress,
                  validatorCbor: token.vestingValidatorCbor,
                  unlockMs:      token.vestingUnlockMs,
                  claimedTxHash: token.vestingClaimedTxHash,
                  source:        'launch',
                });
              }
              for (const v of token.extraVestings ?? []) {
                positions.push({
                  address:       v.address,
                  validatorCbor: v.validatorCbor,
                  unlockMs:      v.unlockMs,
                  claimedTxHash: v.claimedTxHash,
                  source:        'extra',
                  isExtra:       true,
                });
              }
              return (
                <VestingClaimPanel
                  policyId={token.policyId}
                  assetName={token.assetName}
                  ticker={token.ticker}
                  creatorAddress={token.creatorAddress}
                  positions={positions}
                />
              );
            })()}

            <TradePanel
              policyId={token.policyId}
              assetName={token.assetName}
              curveAddress={token.curveAddress}
              creatorAddress={token.creatorAddress}
              validatorCbor={token.validatorCbor}
              ticker={token.ticker}
              creatorFeeBps={token.creatorFeeBps}
              feeAccumulatorAddress={token.feeAccumulatorAddress}
            />

            {/* Queue mode only — hidden when NEXT_PUBLIC_USE_QUEUE is unset.
                Lists this wallet's pending orders for this token with an
                owner-signed Cancel button as the escape hatch. */}
            <PendingOrders
              policyId={token.policyId}
              assetName={token.assetName}
              ticker={token.ticker}
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
            vestingAddresses={vestingAddresses}
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
