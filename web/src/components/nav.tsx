'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WalletButton } from './wallet-button';

export function Nav() {
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
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center font-bold text-lg tracking-tight shrink-0"
            style={{
              color: 'var(--teal)',
              textShadow: '0 0 20px rgba(92, 224, 210, 0.5)',
              fontFamily: 'var(--font-outfit), system-ui, sans-serif',
            }}
          >
            lump<span style={{ color: 'var(--text-dim)', textShadow: 'none' }}>.</span>fun
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden sm:flex items-center gap-1 flex-1">
            <NavLink href="/">Tokens</NavLink>
            <NavLink href="/create">Launch</NavLink>
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
          <MobileLink href="/" onClick={() => setMenuOpen(false)}>Tokens</MobileLink>
          <MobileLink href="/create" onClick={() => setMenuOpen(false)}>+ Launch Token</MobileLink>
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
