import { AudienceCards } from './landing-cards';

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
      {/* Wordmark — LUMP stays bright; FUN runs the teal→lava rift gradient. */}
      <h1
        className="text-center font-bold leading-none mb-6"
        style={{
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontSize: 'clamp(56px, 14vw, 180px)',
          letterSpacing: '-0.04em',
        }}
      >
        <span
          style={{
            background: 'linear-gradient(180deg, var(--text-bright) 0%, var(--text) 70%, rgba(92,224,210,0.30) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          LUMP
        </span>
        <span
          style={{
            background: 'linear-gradient(135deg, #5ce0d2 0%, #5ce0d2 35%, #ff6b35 70%, #e85a2a 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 0 24px rgba(232,90,42,0.18))',
          }}
        >
          FUN
        </span>
      </h1>

      <p
        className="text-center mb-12 max-w-md"
        style={{
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontSize: 16,
        }}
      >
        Earn 1% Creator Fees on Every Trade
      </p>

      {/* Audience selector */}
      <p
        className="mb-5 text-sm uppercase tracking-[0.2em]"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}
      >
        I am a(n)…
      </p>

      <AudienceCards />
    </div>
  );
}
