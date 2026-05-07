'use client';

import { useEffect } from 'react';
import Link from 'next/link';

// Route-level error boundary for /token/[policyId].
//
// iOS Safari aborts the whole page on uncaught client errors and shows its
// native "page couldn't load" UI — even when only one component crashed
// (typical culprit: a CIP-30 wallet returns a quantity Lucid Evolution
// can't fold into its bigint math). This boundary catches the throw,
// keeps the page mounted, and surfaces a recoverable Reload button.

export default function TokenError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[token route] uncaught error:', error);
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <div
        className="rounded-xl p-6 flex flex-col gap-4"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-mid)',
        }}
      >
        <h1
          className="text-xl font-semibold"
          style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}
        >
          Something glitched on this token
        </h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6 }}>
          A wallet or chain call threw before the page could finish loading.
          The on-chain state is unaffected — only the UI hit a snag. Reloading
          usually clears it. If it keeps happening, try disconnecting your
          wallet or opening the page in a fresh tab.
        </p>
        {error.message && (
          <pre
            className="text-[11px] rounded-md p-3 overflow-x-auto"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-jetbrains), monospace',
              lineHeight: 1.5,
            }}
          >
            {error.message}
          </pre>
        )}
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '10px 22px',
              background: 'var(--teal)',
              color: 'var(--bg-deep)',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 13,
              fontFamily: 'var(--font-outfit)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload component
          </button>
          <Link
            href="/feed"
            style={{
              padding: '10px 22px',
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--border-mid)',
              borderRadius: 10,
              fontWeight: 600,
              fontSize: 13,
              fontFamily: 'var(--font-outfit)',
              textDecoration: 'none',
            }}
          >
            ← Back to feed
          </Link>
        </div>
      </div>
    </div>
  );
}
