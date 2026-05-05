import Link from 'next/link';

export default function AgentLandingPage() {
  return (
    <div
      className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center px-4 py-16"
      style={{
        background: 'var(--bg-deep)',
        backgroundImage: 'radial-gradient(ellipse at top, rgba(232,90,42,0.06), transparent 55%)',
      }}
    >
      <div
        className="rounded-2xl px-6 py-2 mb-6 text-xs uppercase tracking-[0.25em]"
        style={{
          color: 'var(--lava-bright)',
          background: 'rgba(232,90,42,0.08)',
          border: '1px solid rgba(232,90,42,0.25)',
          fontFamily: 'var(--font-outfit)',
        }}
      >
        Agent SDK · Coming Soon
      </div>

      <h1
        className="text-center font-bold mb-4"
        style={{
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontSize: 'clamp(40px, 6vw, 72px)',
          color: 'var(--text-bright)',
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
        }}
      >
        Trade autonomously.
      </h1>

      <p
        className="text-center max-w-xl mb-10"
        style={{
          color: 'var(--text-dim)',
          fontSize: 16,
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          lineHeight: 1.55,
        }}
      >
        LumpFun exposes its full bonding-curve trading layer over JSON HTTP
        endpoints — discoverable, deterministic, and signable from any
        Cardano-aware agent. Pre-graduation curves and post-graduation
        Minswap V2 pools share one interface.
      </p>

      <div
        className="rounded-xl p-5 max-w-2xl w-full mb-8 text-sm"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-jetbrains), monospace',
          color: 'var(--text-dim)',
          lineHeight: 1.7,
        }}
      >
        <div><span style={{ color: 'var(--teal)' }}>GET</span>  /api/tokens          <span style={{ color: 'var(--text-dim)', opacity: 0.7 }}>// list every launched token</span></div>
        <div><span style={{ color: 'var(--teal)' }}>GET</span>  /api/curve           <span style={{ color: 'var(--text-dim)', opacity: 0.7 }}>// live bonding-curve reserves</span></div>
        <div><span style={{ color: 'var(--teal)' }}>GET</span>  /api/price-history   <span style={{ color: 'var(--text-dim)', opacity: 0.7 }}>// OHLC bars per interval</span></div>
        <div><span style={{ color: 'var(--teal)' }}>GET</span>  /api/holders         <span style={{ color: 'var(--text-dim)', opacity: 0.7 }}>// per-token holder list</span></div>
        <div><span style={{ color: 'var(--teal)' }}>GET</span>  /api/trades          <span style={{ color: 'var(--text-dim)', opacity: 0.7 }}>// recent trade flow</span></div>
        <div><span style={{ color: 'var(--lava-bright)' }}>POST</span> /api/swap-back       <span style={{ color: 'var(--text-dim)', opacity: 0.7 }}>// SDK-level Minswap V2 sell</span></div>
      </div>

      <p
        className="text-center max-w-xl mb-10 text-sm"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}
      >
        Full SDK docs, agent prompts, and signed-tx examples are landing soon.
      </p>

      <div className="flex gap-3">
        <Link
          href="/api/tokens"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: '10px 22px',
            background: 'var(--lava-bright)',
            color: '#fff',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            fontFamily: 'var(--font-outfit)',
            boxShadow: '0 0 20px rgba(232,90,42,0.35)',
            textDecoration: 'none',
          }}
        >
          Try /api/tokens →
        </Link>
        <Link
          href="/"
          style={{
            padding: '10px 22px',
            background: 'transparent',
            color: 'var(--text-dim)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            fontFamily: 'var(--font-outfit)',
            textDecoration: 'none',
          }}
        >
          ← Back
        </Link>
      </div>
    </div>
  );
}
