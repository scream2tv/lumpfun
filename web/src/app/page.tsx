import Link from 'next/link';

// LumpFun landing page. Forks the visitor by audience: humans go to the
// token feed; AI agents go to a docs/SDK landing page (placeholder for now).
// The /feed route holds what used to live at /.

export default function LandingPage() {
  return (
    <div
      className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center px-4"
      style={{
        background: 'var(--bg-deep)',
        // Subtle radial vignette tinted with the teal/lava brand colours.
        backgroundImage:
          'radial-gradient(ellipse at top, rgba(92,224,210,0.08), transparent 55%),' +
          'radial-gradient(ellipse at bottom, rgba(232,90,42,0.08), transparent 55%)',
      }}
    >
      {/* Wordmark */}
      <h1
        className="text-center font-bold leading-none mb-6"
        style={{
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontSize: 'clamp(56px, 14vw, 180px)',
          letterSpacing: '-0.04em',
          background: 'linear-gradient(180deg, var(--text-bright) 0%, var(--text) 60%, rgba(92,224,210,0.25) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textShadow: '0 0 80px rgba(92,224,210,0.10)',
        }}
      >
        LUMPFUN
      </h1>

      <p
        className="text-center mb-12 max-w-md"
        style={{
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontSize: 16,
        }}
      >
        Fair-launch tokens on Cardano. Bonding curve to Minswap, the moment
        you graduate.
      </p>

      {/* Audience selector */}
      <p
        className="mb-5 text-sm uppercase tracking-[0.2em]"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}
      >
        I am a(n)…
      </p>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-2xl">
        <AudienceCard
          href="/feed"
          label="Human"
          accent="teal"
          subtitle="Browse, trade, and launch tokens."
        />
        <AudienceCard
          href="/agent"
          label="Agent"
          accent="lava"
          subtitle="API endpoints & SDK for autonomous trading."
        />
      </div>
    </div>
  );
}

function AudienceCard({
  href,
  label,
  subtitle,
  accent,
}: {
  href: string;
  label: string;
  subtitle: string;
  accent: 'teal' | 'lava';
}) {
  const accentColor = accent === 'teal' ? 'var(--teal)' : 'var(--lava-bright)';
  const accentMuted = accent === 'teal' ? 'rgba(92,224,210,0.08)' : 'rgba(232,90,42,0.08)';
  const accentBorder = accent === 'teal' ? 'rgba(92,224,210,0.25)' : 'rgba(232,90,42,0.25)';
  const accentGlow = accent === 'teal' ? 'rgba(92,224,210,0.18)' : 'rgba(232,90,42,0.18)';

  return (
    <Link
      href={href}
      className="group flex-1 rounded-2xl p-6 sm:p-8 flex flex-col gap-2 transition-all duration-200"
      style={{
        background: accentMuted,
        border: `1px solid ${accentBorder}`,
        textDecoration: 'none',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 28,
          color: accentColor,
          textShadow: `0 0 20px ${accentGlow}`,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: 'var(--text-dim)',
          fontSize: 13,
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          lineHeight: 1.5,
        }}
      >
        {subtitle}
      </span>
      <span
        className="mt-3 inline-flex items-center gap-1 text-sm group-hover:translate-x-1 transition-transform"
        style={{
          color: accentColor,
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontWeight: 600,
        }}
      >
        Enter →
      </span>
    </Link>
  );
}
