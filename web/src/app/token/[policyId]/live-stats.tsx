'use client';

import { useQuery } from '@tanstack/react-query';
import { BondingProgress } from '@/components/bonding-progress';
import { spotPrice, marketCap, bondedBps, TOTAL_SUPPLY } from '@/lib/curve-math';
import { safeBigInt } from '@/lib/utils';

// Owns the live-updated metrics on the token detail page (Market Cap +
// bonding progress). Subscribes to the shared ['curve', address, asset]
// React Query key so the trade panel and this component share one network
// poll — invalidating from a successful trade in the trade panel updates
// both at once.

export const CURVE_QUERY_KEY = (curveAddress: string, assetUnit: string) =>
  ['curve', curveAddress, assetUnit] as const;

interface LiveCurve { adaReserve: string; tokenReserve: string }

async function fetchCurve(curveAddress: string, assetUnit: string): Promise<LiveCurve | null> {
  const res = await fetch(
    `/api/curve?address=${encodeURIComponent(curveAddress)}&asset=${encodeURIComponent(assetUnit)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return null;
  return res.json();
}

interface Props {
  curveAddress:        string;
  assetUnit:           string;
  // Server-rendered initial values so the page paints with real data and
  // doesn't flash a placeholder before the first client poll lands.
  initialAdaReserve:   string;          // bigint as string
  initialTokenReserve: string;
  // Static / slow-changing values that come from the server render only.
  holderCount:         number;
  createdRel:          string;
  vestingBalance:      bigint | null;
  ticker:              string;
  graduated:           boolean;
}

function fmtMcap(ada: number): string {
  if (ada >= 1_000_000) return `₳${(ada / 1_000_000).toFixed(2)}M`;
  if (ada >= 1_000)     return `₳${(ada / 1_000).toFixed(2)}K`;
  return `₳${ada.toFixed(2)}`;
}

export function LiveStats({
  curveAddress, assetUnit,
  initialAdaReserve, initialTokenReserve,
  holderCount, createdRel, vestingBalance, ticker, graduated,
}: Props) {
  // Skip polling once the curve has graduated — UTxO is gone and reserves
  // come from the post-graduation pool snapshot in the registry. The page
  // server-renders those values into initial* props, which we just display.
  const { data } = useQuery({
    queryKey: CURVE_QUERY_KEY(curveAddress, assetUnit),
    queryFn:  () => fetchCurve(curveAddress, assetUnit),
    enabled:  !graduated,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    initialData: { adaReserve: initialAdaReserve, tokenReserve: initialTokenReserve } satisfies LiveCurve,
  });

  const adaReserve   = safeBigInt(data ? data.adaReserve   : initialAdaReserve);
  const tokenReserve = safeBigInt(data ? data.tokenReserve : initialTokenReserve);

  const price       = spotPrice(adaReserve, tokenReserve);
  const mcapLove    = marketCap(adaReserve, tokenReserve);
  const mcapAda     = Number(mcapLove) / 1_000_000;
  const bondedPct   = Number(bondedBps(adaReserve)) / 100;
  const adaInCurve  = Number(adaReserve) / 1_000_000;
  const vestingBig  = vestingBalance === null ? null : safeBigInt(vestingBalance);

  return (
    <>
      <div className="flex flex-wrap gap-x-6 gap-y-3 sm:gap-x-10 py-2">
        <MetricCell label="Market Cap" value={fmtMcap(mcapAda)} accent="var(--teal)" />
        <MetricCell label="Holders"    value={holderCount > 0 ? holderCount.toLocaleString() : '—'} />
        <MetricCell label="Created"    value={createdRel} />
        {vestingBig !== null && vestingBig > 0n && (
          <MetricCell
            label="Vested"
            value={`${(Number(vestingBig) / Number(TOTAL_SUPPLY) * 100).toFixed(2)}%`}
            accent="var(--teal)"
          />
        )}
      </div>

      <BondingProgress bondedPct={bondedPct} graduated={graduated} adaReserve={adaInCurve} />
      {/* Hidden price field reserved for future debug overlays. */}
      <span style={{ display: 'none' }}>{String(price)}</span>
    </>
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
