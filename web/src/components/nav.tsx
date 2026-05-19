'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { WalletButton } from './wallet-button';
import { ChainToggle } from './chain-toggle';

export function Nav() {
  const pathname = usePathname();
  const onMidnight = pathname.startsWith('/midnight');
  const [scrolled,  setScrolled]  = useState(false);
  const [menuOpen,  setMenuOpen]  = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, []);

  return (
    <>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          width: '100%',
          background: scrolled ? 'var(--glass-bg)' : 'rgba(10, 9, 8, 0.75)',
          backdropFilter: 'blur(var(--glass-blur))',
          WebkitBackdropFilter: 'blur(var(--glass-blur))',
          borderBottom: `1px solid ${scrolled ? 'var(--border-mid)' : 'var(--glass-border)'}`,
          transition: 'background 300ms var(--ease-out-expo), border-color 300ms var(--ease-out-expo)',
        }}
      >
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 gap-3">
          {/* Logo — `fun` runs the same teal→lava rift gradient as the landing wordmark. */}
          <Link
            href="/"
            className="flex items-center font-bold text-lg tracking-tight shrink-0"
            style={{ fontFamily: 'var(--font-outfit), system-ui, sans-serif' }}
          >
            <span style={{ color: 'var(--teal)', textShadow: '0 0 20px rgba(92, 224, 210, 0.5)' }}>
              lump
            </span>
            <span
              style={{
                background: 'linear-gradient(135deg, #5ce0d2 0%, #5ce0d2 35%, #ff6b35 70%, #e85a2a 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                filter: 'drop-shadow(0 0 8px rgba(232,90,42,0.25))',
              }}
            >
              fun
            </span>
          </Link>

          {/* Chain toggle — Cardano (default) <-> Midnight preprod */}
          <div className="hidden sm:flex shrink-0">
            <ChainToggle />
          </div>

          {/* Desktop nav links — chain-aware. Cardano: Tokens (Launch is
              paused). Midnight: Activity feed; launch is "coming soon". */}
          <nav className="hidden sm:flex items-center gap-1 flex-1">
            {onMidnight ? (
              <NavLink href="/midnight/feed">Activity</NavLink>
            ) : (
              <NavLink href="/feed">Tokens</NavLink>
            )}
          </nav>

          {/* Right: wallet + mobile hamburger */}
          <div className="flex items-center gap-2">
            <WalletButton />
            {/* Mobile hamburger */}
            <button
              className="sm:hidden flex flex-col gap-1.5 p-2 rounded-md"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(o => !o)}
              style={{ background: menuOpen ? 'var(--bg-elevated)' : 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <span style={{ display: 'block', width: 18, height: 1.5, background: 'var(--text-dim)', transition: 'transform 200ms', transform: menuOpen ? 'translateY(5px) rotate(45deg)' : 'none' }} />
              <span style={{ display: 'block', width: 18, height: 1.5, background: 'var(--text-dim)', opacity: menuOpen ? 0 : 1, transition: 'opacity 200ms' }} />
              <span style={{ display: 'block', width: 18, height: 1.5, background: 'var(--text-dim)', transition: 'transform 200ms', transform: menuOpen ? 'translateY(-5px) rotate(-45deg)' : 'none' }} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div
          className="sm:hidden fixed inset-x-0 z-40 flex flex-col p-4 gap-1"
          style={{
            top: 56,
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-mid)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <div className="px-2 pb-2"><ChainToggle /></div>
          {onMidnight ? (
            <MobileLink href="/midnight/feed" onClick={() => setMenuOpen(false)}>Activity</MobileLink>
          ) : (
            <MobileLink href="/feed" onClick={() => setMenuOpen(false)}>Tokens</MobileLink>
          )}
        </div>
      )}
    </>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-sm rounded-md transition-colors"
      style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit), system-ui, sans-serif' }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.color = 'var(--text)';
        (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)';
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {children}
    </Link>
  );
}

function MobileLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center rounded-lg px-4 text-sm font-medium"
      style={{
        height: 48,
        color: 'var(--text)',
        fontFamily: 'var(--font-outfit), system-ui, sans-serif',
        background: 'transparent',
        borderRadius: 8,
      }}
    >
      {children}
    </Link>
  );
}
