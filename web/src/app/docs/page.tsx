import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LumpFun Docs',
  description: 'Reference for builders and agents integrating with LumpFun — REST API, on-chain protocol, transaction patterns.',
};

export default function DocsIndex() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <p
        className="text-xs uppercase tracking-[0.25em] mb-3"
        style={{ color: 'var(--lava-bright)', fontFamily: 'var(--font-outfit)' }}
      >
        Builder & Agent Docs
      </p>
      <h1
        className="font-bold mb-3"
        style={{
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          fontSize: 'clamp(36px, 5vw, 56px)',
          color: 'var(--text-bright)',
          letterSpacing: '-0.02em',
        }}
      >
        Build on LumpFun
      </h1>
      <p
        className="text-base mb-10"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)', lineHeight: 1.55 }}
      >
        LumpFun is a Cardano-native fair-launch bonding curve. Tokens mint
        with a one-shot policy, trade against an on-chain constant-product
        curve, and graduate to Minswap V2 once they cross the configured
        ADA threshold. Everything below the UI is open: read state via REST,
        build transactions with any CIP-30 wallet + Lucid Evolution, sign,
        submit. No proprietary SDK required.
      </p>

      <h2 style={h2}>What you can build</h2>
      <ul style={ul}>
        <Item><strong style={strong}>Trading agents</strong> — read live curve state, compute slippage, submit signed buys/sells.</Item>
        <Item><strong style={strong}>Portfolio dashboards</strong> — list tokens, fetch holdings, render OHLC charts.</Item>
        <Item><strong style={strong}>Indexers / explorers</strong> — derive trade history straight from Cardano without re-implementing the curve math.</Item>
        <Item><strong style={strong}>Launch automation</strong> — programmatic token launches with custom vesting / dev allocation parameters.</Item>
        <Item><strong style={strong}>Sniper / MEV</strong> — go for it. The curve is exact constant-product; trades from the same block compete on tx-fee.</Item>
      </ul>

      <h2 style={h2}>Sections</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-12">
        <DocsLink
          href="/docs/api"
          label="REST API Reference"
          desc="Every public endpoint, request/response shape, code samples in curl + TypeScript."
        />
        <DocsLink
          href="/docs/protocol"
          label="On-Chain Protocol"
          desc="Aiken validators, parameterisation, datum/redeemer encoding, full launch / buy / sell tx walkthroughs."
        />
      </div>

      <h2 style={h2}>Quick start</h2>
      <p style={p}>List every token currently launched on the protocol:</p>
      <CodeBlock>{`curl https://lumpfun.com/api/tokens`}</CodeBlock>

      <p style={p}>Fetch live curve reserves and a buy quote (no math required):</p>
      <CodeBlock>{`POLICY=ec11a20dc05761a24c415cfc85b42ef5b31caa52dd501082d6744b9c

# Curve state
curl "https://lumpfun.com/api/curve?address=$(curl -s https://lumpfun.com/api/token/$POLICY | jq -r .curveAddress)&asset=$POLICY$(curl -s https://lumpfun.com/api/token/$POLICY | jq -r .assetName)"

# Quote: 5 ADA buy
curl "https://lumpfun.com/api/quote?policyId=$POLICY&side=buy&amount=5000000"`}</CodeBlock>

      <h2 style={h2}>Stability</h2>
      <p style={p}>
        REST endpoints documented in <Link href="/docs/api" style={link}>/docs/api</Link>{' '}
        are stable. Response shapes are additive — we may add fields, but won&apos;t
        break or remove existing ones without a deprecation window. Anything
        not documented in those pages should be treated as private (registry
        writes, treasury operations, etc.) and may change without notice.
      </p>

      <h2 style={h2}>Network & rate limits</h2>
      <ul style={ul}>
        <Item>Production API base URL: <code style={code}>https://lumpfun.com</code></Item>
        <Item>Cardano network: <strong style={strong}>Mainnet</strong>. Tokens use real ADA.</Item>
        <Item>No API key required for read endpoints.</Item>
        <Item>
          Rate limits aren&apos;t enforced yet. Be polite — hammering the
          curve/quote routes in a tight loop hits Blockfrost on our side and
          may get your IP throttled if it impacts other users.
        </Item>
      </ul>

      <h2 style={h2}>Disclaimer</h2>
      <p style={p}>
        LumpFun is experimental, unaudited software on Cardano mainnet.
        Tokens launched here are highly speculative experiments and most
        will lose all value. Building automation against the protocol means
        you&apos;re responsible for your own risk model, slippage, and key
        management. The protocol cannot reverse, refund, or recover
        transactions.
      </p>
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start">
      <span aria-hidden style={{ color: 'var(--lava-bright)', marginTop: 4, fontSize: 10 }}>▸</span>
      <span>{children}</span>
    </li>
  );
}

function DocsLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl p-4 flex flex-col gap-1 transition-colors group"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-mid)',
        textDecoration: 'none',
      }}
    >
      <span
        className="font-semibold group-hover:[color:var(--teal)] transition-colors"
        style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}
      >
        {label} →
      </span>
      <span className="text-sm" style={{ color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {desc}
      </span>
    </Link>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      className="rounded-lg p-4 mb-5 overflow-x-auto text-xs"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-jetbrains), monospace',
        color: 'var(--text)',
        lineHeight: 1.6,
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

const h2: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  fontFamily: 'var(--font-outfit), system-ui, sans-serif',
  color: 'var(--text-bright)',
  marginTop: 32,
  marginBottom: 12,
};
const p: React.CSSProperties = {
  fontFamily: 'var(--font-outfit)',
  fontSize: 14,
  color: 'var(--text-dim)',
  lineHeight: 1.6,
  marginBottom: 14,
};
const ul: React.CSSProperties = {
  fontFamily: 'var(--font-outfit)',
  fontSize: 14,
  color: 'var(--text-dim)',
  lineHeight: 1.7,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 24,
};
const link: React.CSSProperties = {
  color: 'var(--teal)',
  textDecoration: 'underline',
};
const strong: React.CSSProperties = {
  color: 'var(--text)',
  fontWeight: 600,
};
const code: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  padding: '2px 6px',
  borderRadius: 4,
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: 12,
  color: 'var(--teal)',
};
