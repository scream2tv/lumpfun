'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Chain = 'cardano' | 'midnight';

function currentChain(pathname: string): Chain {
  return pathname.startsWith('/midnight') ? 'midnight' : 'cardano';
}

export function ChainToggle() {
  const pathname = usePathname();
  const active = currentChain(pathname);

  return (
    <div
      className="inline-flex items-center rounded-full p-0.5"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-subtle)',
      }}
      role="tablist"
      aria-label="Network"
    >
      <ChainPill href="/" label="Cardano" accent="var(--teal)" active={active === 'cardano'} />
      <ChainPill href="/midnight" label="Midnight" accent="#a78bfa" active={active === 'midnight'} sub="preprod" />
    </div>
  );
}

function ChainPill({
  href,
  label,
  accent,
  active,
  sub,
}: {
  href: string;
  label: string;
  accent: string;
  active: boolean;
  sub?: string;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors"
      style={{
        background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
        color: active ? 'var(--text-bright)' : 'var(--text-dim)',
        boxShadow: active ? `inset 0 0 0 1px ${accent}33` : 'none',
        fontFamily: 'var(--font-outfit), system-ui, sans-serif',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: 999,
          background: accent,
          boxShadow: active ? `0 0 8px ${accent}` : 'none',
        }}
      />
      {label}
      {sub ? (
        <span style={{ color: 'var(--text-dim)', fontSize: 10, marginLeft: 2 }}>{sub}</span>
      ) : null}
    </Link>
  );
}
