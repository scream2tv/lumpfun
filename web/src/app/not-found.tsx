import Link from 'next/link';

// Branded 404 — replaces the bare "This page could not be found" Next.js
// default. Triggered both by missing routes and any notFound() call from
// a server component (the token detail page being the most common path).

export default function NotFound() {
  return (
    <div
      className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center px-4 py-16 text-center"
      style={{
        background: 'var(--bg-deep)',
        backgroundImage:
          'radial-gradient(ellipse at top, rgba(92,224,210,0.06), transparent 55%),' +
          'radial-gradient(ellipse at bottom, rgba(232,90,42,0.06), transparent 55%)',
      }}
    >
      <p
        className="text-xs uppercase tracking-[0.25em] mb-4"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}
      >
        404
      </p>
      <h1
        className="font-bold mb-3"
        style={{
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontSize: 'clamp(32px, 5vw, 56px)',
          color: 'var(--text-bright)',
          letterSpacing: '-0.02em',
        }}
      >
        Page not found
      </h1>
      <p
        className="text-sm max-w-md mb-8"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)', lineHeight: 1.55 }}
      >
        That URL doesn&apos;t map to a token in the LumpFun registry — it may
        have been removed, or the link was incomplete. Try the feed, or
        launch something new.
      </p>
      <div className="flex gap-3 flex-wrap justify-center">
        <Link
          href="/feed"
          style={{
            padding: '10px 22px',
            background: 'var(--teal)',
            color: 'var(--bg-deep)',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            fontFamily: 'var(--font-outfit)',
            textDecoration: 'none',
            boxShadow: '0 0 16px rgba(92,224,210,0.32)',
          }}
        >
          Browse tokens →
        </Link>
        <Link
          href="/create"
          style={{
            padding: '10px 22px',
            background: 'transparent',
            color: 'var(--text)',
            border: '1px solid var(--border-mid)',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            fontFamily: 'var(--font-outfit)',
            textDecoration: 'none',
          }}
        >
          Launch a token
        </Link>
      </div>
    </div>
  );
}
