'use client';

interface Props {
  bondedPct: number;
  graduated: boolean;
  adaReserve?: number;
  className?: string;
}

import { GRADUATION_ADA as GRAD_LOVELACE } from '@/lib/curve-math';
const GRADUATION_ADA = Number(GRAD_LOVELACE) / 1_000_000;

export function BondingProgress({ bondedPct, graduated, adaReserve, className }: Props) {
  const toGraduate = adaReserve !== undefined && !graduated
    ? Math.max(0, GRADUATION_ADA - Math.round(adaReserve))
    : null;
  const pct = Math.max(0, Math.min(bondedPct, 100));
  // Tiny progress (e.g. 0.05%) renders as sub-pixel — give it a visible nub.
  const visualPct = pct > 0 && pct < 1 ? Math.max(pct, 0.5) : pct;
  const pctLabel = pct > 0 && pct < 1 ? pct.toFixed(2) : pct.toFixed(1);

  const barColor = graduated
    ? 'var(--amber)'
    : pct >= 80
    ? 'linear-gradient(90deg, var(--teal-dim), var(--teal-hot))'
    : 'linear-gradient(90deg, var(--teal-dim), var(--teal))';

  const glowColor = graduated
    ? '0 0 8px rgba(212, 146, 42, 0.5)'
    : pct >= 80
    ? '0 0 10px rgba(92, 224, 210, 0.6)'
    : '0 0 6px rgba(92, 224, 210, 0.3)';

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs" style={{ color: 'var(--text-dim)' }}>Bonding progress</span>
        {graduated ? (
          <span className="text-xs font-medium" style={{ color: 'var(--amber-bright)' }}>Graduated ✓</span>
        ) : (
          <div className="flex items-center gap-2">
            {toGraduate !== null && toGraduate > 0 && (
              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                {toGraduate.toLocaleString()} ADA to go
              </span>
            )}
            <span className="text-xs font-semibold tabular-nums"
              style={{ color: pct >= 80 ? 'var(--teal-hot)' : 'var(--teal)' }}>
              {pctLabel}%
            </span>
          </div>
        )}
      </div>
      {/* Track */}
      <div
        className="relative w-full overflow-hidden"
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--bg-elevated)',
        }}
      >
        {/* Fill */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            right: `${100 - visualPct}%`,
            background: barColor,
            boxShadow: glowColor,
            borderRadius: 3,
            transition: 'right 600ms var(--ease-out-expo)',
          }}
        />
      </div>
    </div>
  );
}
