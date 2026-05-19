'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const ACK_KEY = 'lumpfun_risk_ack_v1';

// Audience selector cards on the landing page. The Human path is gated by a
// disclaimer modal on first click — once acknowledged, subsequent visits skip
// the modal (localStorage flag). Agent path navigates straight through.

export function AudienceCards() {
  return (
    <div className="flex flex-col sm:flex-row gap-4 w-full max-w-2xl">
      <HumanCard />
      <AgentCard />
    </div>
  );
}

function HumanCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (typeof window !== 'undefined' && window.localStorage.getItem(ACK_KEY) === '1') {
      router.push('/feed');
      return;
    }
    setOpen(true);
  };

  const accept = () => {
    if (typeof window !== 'undefined') window.localStorage.setItem(ACK_KEY, '1');
    setOpen(false);
    router.push('/feed');
  };

  return (
    <>
      <CardShell
        onClick={handleClick}
        label="Human"
        subtitle="Browse and trade tokens."
        accent="teal"
      />
      {open && <DisclaimerModal onAccept={accept} onClose={() => setOpen(false)} />}
    </>
  );
}

function AgentCard() {
  return (
    <Link
      href="/agent"
      className="group flex-1 rounded-2xl p-6 sm:p-8 flex flex-col gap-2 transition-all duration-200"
      style={{
        background: 'rgba(232,90,42,0.08)',
        border: '1px solid rgba(232,90,42,0.25)',
        textDecoration: 'none',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 28,
          color: 'var(--lava-bright)',
          textShadow: '0 0 20px rgba(232,90,42,0.18)',
        }}
      >
        Agent
      </span>
      <span
        style={{
          color: 'var(--text-dim)',
          fontSize: 13,
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          lineHeight: 1.5,
        }}
      >
        API endpoints &amp; SDK for autonomous trading.
      </span>
      <span
        className="mt-3 inline-flex items-center gap-1 text-sm group-hover:translate-x-1 transition-transform"
        style={{
          color: 'var(--lava-bright)',
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontWeight: 600,
        }}
      >
        Enter →
      </span>
    </Link>
  );
}

function CardShell({
  onClick,
  label,
  subtitle,
  accent,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
  subtitle: string;
  accent: 'teal' | 'lava';
}) {
  const accentColor  = accent === 'teal' ? 'var(--teal)' : 'var(--lava-bright)';
  const accentMuted  = accent === 'teal' ? 'rgba(92,224,210,0.08)' : 'rgba(232,90,42,0.08)';
  const accentBorder = accent === 'teal' ? 'rgba(92,224,210,0.25)' : 'rgba(232,90,42,0.25)';
  const accentGlow   = accent === 'teal' ? 'rgba(92,224,210,0.18)' : 'rgba(232,90,42,0.18)';

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex-1 rounded-2xl p-6 sm:p-8 flex flex-col gap-2 transition-all duration-200 text-left cursor-pointer"
      style={{ background: accentMuted, border: `1px solid ${accentBorder}` }}
    >
      <span style={{ fontFamily: 'var(--font-outfit), system-ui, sans-serif', fontWeight: 700, fontSize: 28, color: accentColor, textShadow: `0 0 20px ${accentGlow}` }}>
        {label}
      </span>
      <span style={{ color: 'var(--text-dim)', fontSize: 13, fontFamily: 'var(--font-outfit), system-ui, sans-serif', lineHeight: 1.5 }}>
        {subtitle}
      </span>
      <span
        className="mt-3 inline-flex items-center gap-1 text-sm group-hover:translate-x-1 transition-transform"
        style={{ color: accentColor, fontFamily: 'var(--font-outfit), system-ui, sans-serif', fontWeight: 600 }}
      >
        Enter →
      </span>
    </button>
  );
}

function DisclaimerModal({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-4"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-mid)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="disclaimer-title"
          className="text-xl font-bold"
          style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}
        >
          Before you continue
        </h2>

        <ul
          className="flex flex-col gap-2.5 text-sm"
          style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit), system-ui, sans-serif', lineHeight: 1.55 }}
        >
          <Bullet>
            <strong style={{ color: 'var(--text)' }}>LumpFun is experimental, unaudited software on Cardano mainnet.</strong>{' '}
            Bugs or exploits may result in permanent loss of funds.
          </Bullet>
          <Bullet>
            <strong style={{ color: 'var(--text)' }}>Tokens launched on LumpFun are highly speculative experiments, not investments.</strong>{' '}
            Most may lose all value. Only use ADA you can afford to lose.
          </Bullet>
          <Bullet>
            <strong style={{ color: 'var(--text)' }}>Every trade includes fees:</strong>{' '}
            1 ADA to the protocol and 1% to the token creator.
          </Bullet>
          <Bullet>
            <strong style={{ color: 'var(--text)' }}>Transactions are irreversible.</strong>{' '}
            You are responsible for your wallet, your keys, and for verifying tokens, contracts, and
            transaction details before signing.
          </Bullet>
        </ul>

        <p
          className="text-xs"
          style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit), system-ui, sans-serif' }}
        >
          By continuing, you acknowledge the risks and accept these terms.
        </p>

        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg text-sm font-semibold py-2.5"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-outfit)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="flex-1 rounded-lg text-sm font-semibold py-2.5"
            style={{
              background: 'var(--teal)',
              color: 'var(--bg-deep)',
              border: 'none',
              fontFamily: 'var(--font-outfit)',
              boxShadow: '0 0 16px rgba(92,224,210,0.35)',
              cursor: 'pointer',
            }}
          >
            Accept &amp; continue
          </button>
        </div>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start">
      <span aria-hidden style={{ color: 'var(--teal)', marginTop: 2 }}>•</span>
      <span>{children}</span>
    </li>
  );
}
