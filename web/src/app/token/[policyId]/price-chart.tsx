'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { Candle } from '@/app/api/price-history/route';

type Timeframe = '5m' | '15m' | '1h' | 'all';

const TIMEFRAMES: Array<{ label: string; value: Timeframe }> = [
  { label: '5m',  value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1h',  value: '1h' },
  { label: 'ALL', value: 'all' },
];

async function fetchCandles(curveAddress: string, assetUnit: string, timeframe: Timeframe): Promise<Candle[]> {
  const res = await fetch(
    `/api/price-history?address=${encodeURIComponent(curveAddress)}&asset=${encodeURIComponent(assetUnit)}&timeframe=${timeframe}`,
  );
  if (!res.ok) return [];
  return res.json();
}

function OhlcTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d: Candle = payload[0].payload;
  const isUp = d.close >= d.open;
  const candleColor = isUp ? 'var(--teal)' : 'var(--lava)';
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs flex flex-col gap-1"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)', minWidth: 140 }}
    >
      <p className="font-semibold mb-0.5" style={{ color: 'var(--text-dim)' }}>{label}</p>
      <div className="flex justify-between gap-3">
        <span style={{ color: 'var(--text-dim)' }}>O</span>
        <span style={{ color: candleColor, fontFamily: 'var(--font-jetbrains), monospace' }}>{d.open.toFixed(8)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span style={{ color: 'var(--text-dim)' }}>H</span>
        <span style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}>{d.high.toFixed(8)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span style={{ color: 'var(--text-dim)' }}>L</span>
        <span style={{ color: 'var(--lava)', fontFamily: 'var(--font-jetbrains), monospace' }}>{d.low.toFixed(8)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span style={{ color: 'var(--text-dim)' }}>C</span>
        <span style={{ color: candleColor, fontWeight: 700, fontFamily: 'var(--font-jetbrains), monospace' }}>{d.close.toFixed(8)}</span>
      </div>
    </div>
  );
}

export function PriceChart({ curveAddress, assetUnit }: { curveAddress: string; assetUnit: string }) {
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');

  const { data = [], isLoading } = useQuery({
    queryKey: ['price-history', curveAddress, assetUnit, timeframe],
    queryFn: () => fetchCandles(curveAddress, assetUnit, timeframe),
    refetchInterval: 10_000,
  });

  const priceChange = data.length >= 2
    ? ((data[data.length - 1].close - data[0].open) / data[0].open) * 100
    : null;

  const trendColor = priceChange === null ? 'var(--teal)' : priceChange >= 0 ? 'var(--teal)' : 'var(--lava)';

  return (
    <div className="flex flex-col gap-3">
      {/* Timeframe selector */}
      <div className="flex items-center justify-between">
        {priceChange !== null && (
          <span className="text-xs font-semibold" style={{ color: trendColor, fontFamily: 'var(--font-jetbrains), monospace' }}>
            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
          </span>
        )}
        <div className="flex gap-1 ml-auto">
          {TIMEFRAMES.map(tf => {
            const active = timeframe === tf.value;
            return (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                style={{
                  padding: '3px 8px',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: 'var(--font-outfit), system-ui, sans-serif',
                  cursor: 'pointer',
                  border: active ? '1px solid rgba(92,224,210,0.4)' : '1px solid var(--border-subtle)',
                  background: active ? 'rgba(92,224,210,0.12)' : 'transparent',
                  color: active ? 'var(--teal)' : 'var(--text-dim)',
                  transition: 'all 120ms',
                }}
              >
                {tf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart area */}
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-xs" style={{ color: 'var(--text-dim)' }}>
          Loading…
        </div>
      ) : data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-xs" style={{ color: 'var(--text-dim)' }}>
          No trades yet — be the first buyer.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="tealGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#5CE0D2" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#5CE0D2" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.04)"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              tick={{ fontSize: 10, fill: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => v.toFixed(6)}
              width={72}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<OhlcTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="close"
              stroke="#5CE0D2"
              strokeWidth={2}
              fill="url(#tealGradient)"
              dot={false}
              activeDot={{ r: 3, fill: '#5CE0D2', stroke: 'var(--bg-card)', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
