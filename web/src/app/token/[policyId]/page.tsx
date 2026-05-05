import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import { BondingProgress } from '@/components/bonding-progress';
import { CopyButton } from '@/components/copy-button';
import { TradePanel } from './trade-panel';
import { fetchTokenList, fetchTokenInfo, fetchHolderCount } from '@/lib/blockfrost';
import { PriceChart } from './price-chart';
import { TradesHolders } from './trades-holders';

function truncPolicy(id: string) {
  if (!id) return '';
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}

// User-typed strings → real URLs.
function normalizeWebsite(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}
function normalizeTwitter(v: string): string | null {
  const t = v.trim().replace(/^@/, '');
  if (!t) return null;
  if (/^https?:\/\//i.test(v)) return v.trim();
  if (/^(x\.com|twitter\.com)\//i.test(t)) return `https://${t}`;
  return `https://x.com/${t}`;
}
function normalizeTelegram(v: string): string | null {
  const t = v.trim().replace(/^@/, '');
  if (!t) return null;
  if (/^https?:\/\//i.test(v)) return v.trim();
  if (/^t\.me\//i.test(t)) return `https://${t}`;
  return `https://t.me/${t}`;
}
function normalizeDiscord(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^discord\.(gg|com)\//i.test(t)) return `https://${t}`;
  // Bare invite code → discord.gg
  return `https://discord.gg/${t.replace(/^\//, '')}`;
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

function DiscordIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0188 1.3332-.946 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9554 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}
function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function TelegramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.146.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.022c.242-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.642-.204-.66-.642.135-.95l11.566-4.458c.538-.196 1.006.128.832.953z" />
    </svg>
  );
}

function SocialLinks({ website, twitter, telegram, discord }: { website?: string; twitter?: string; telegram?: string; discord?: string }) {
  const links = [
    { url: website  ? normalizeWebsite(website)   : null, Icon: GlobeIcon,    label: 'Website'     },
    { url: twitter  ? normalizeTwitter(twitter)   : null, Icon: XIcon,        label: 'Twitter / X' },
    { url: telegram ? normalizeTelegram(telegram) : null, Icon: TelegramIcon, label: 'Telegram'    },
    { url: discord  ? normalizeDiscord(discord)   : null, Icon: DiscordIcon,  label: 'Discord'     },
  ].filter((l): l is { url: string; Icon: () => React.JSX.Element; label: string } => !!l.url);
  if (links.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      {links.map(({ url, Icon, label }) => (
        <a
          key={label}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          title={label}
          className="flex items-center justify-center"
          style={{
            width: 26, height: 26, borderRadius: 6,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-dim)',
            transition: 'all 150ms',
          }}
        >
          <Icon />
        </a>
      ))}
    </div>
  );
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

          {/* Inline metrics row (snek.fun style) */}
          <div
            className="flex flex-wrap gap-x-6 gap-y-3 sm:gap-x-10 py-2"
          >
            <MetricCell
              label="Market Cap"
              value={`₳${token.marketCapAda >= 1000
                ? (token.marketCapAda / 1000).toFixed(2) + 'K'
                : token.marketCapAda.toFixed(2)}`}
              accent="var(--teal)"
            />
            <MetricCell
              label="Price"
              value={`₳${(Number(token.priceLovelace) / 1_000_000).toFixed(8)}`}
            />
            <MetricCell
              label="Holders"
              value={holderCount > 0 ? holderCount.toLocaleString() : '—'}
            />
            <MetricCell
              label="Created"
              value={relTime(token.launchedAt)}
            />
          </div>

          {/* Bonding progress */}
          <BondingProgress
            bondedPct={token.bondedPct}
            graduated={token.graduated}
            adaReserve={Number(token.adaReserve) / 1_000_000}
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
