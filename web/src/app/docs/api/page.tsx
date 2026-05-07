import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LumpFun REST API',
  description: 'Public REST endpoints for LumpFun: token registry, live curve state, quotes, holders, trade history, OHLC bars, and wallet asset lookup.',
};

const BASE = 'https://lumpfun.vercel.app';

export default function ApiRef() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <p className="text-xs uppercase tracking-[0.25em] mb-2"
        style={{ color: 'var(--lava-bright)', fontFamily: 'var(--font-outfit)' }}>
        <Link href="/docs" style={breadcrumb}>← Docs</Link>
      </p>
      <h1 className="font-bold mb-3" style={h1}>REST API</h1>
      <p style={p}>
        Public read endpoints. All return JSON, no authentication, CORS open.
        Base URL: <code style={code}>{BASE}</code>. All bigint values
        (lovelace, token quantities, reserves) are returned as strings to
        preserve precision; convert to <code style={code}>BigInt</code> on
        the client.
      </p>

      <Toc items={[
        { id: 'tokens',         label: 'GET /api/tokens' },
        { id: 'token-by-id',    label: 'GET /api/token/{policyId}' },
        { id: 'curve',          label: 'GET /api/curve' },
        { id: 'quote',          label: 'GET /api/quote' },
        { id: 'holders',        label: 'GET /api/holders' },
        { id: 'trades',         label: 'GET /api/trades' },
        { id: 'price-history',  label: 'GET /api/price-history' },
        { id: 'wallet-assets',  label: 'GET /api/wallet-assets' },
        { id: 'errors',         label: 'Errors' },
      ]} />

      {/* ── /api/tokens ───────────────────────────────────────────────── */}
      <Section id="tokens" method="GET" path="/api/tokens">
        <p style={p}>List every token registered with LumpFun, ordered newest
          first. Each entry is the full <code style={code}>TokenMeta</code>
          record — the same shape stored in our KV registry.</p>

        <p style={pTitle}>Response (200) — array of:</p>
        <CodeBlock>{`{
  "policyId":     "ec11a20dc05761a24c415cfc85b42ef5b31caa52dd501082d6744b9c",
  "assetName":    "4d5547",                       // hex of utf-8 ticker
  "ticker":       "MUG",
  "name":         "Mug",
  "creatorAddress":   "addr1q...",                // bech32 of creator wallet
  "creatorFeeBps":    100,                        // 100 = 1%, max 200
  "curveAddress":     "addr1w...",                // bonding-curve script
  "validatorCbor":    "59...",                    // parameterised PlutusV3
  "graduationAdaLovelace": "21000000000",         // optional, default 21k ADA
  "imageUri":         "https://...",
  "description":      "...",
  "website":          "https://...",              // all socials optional
  "twitter":          "@handle",
  "telegram":         "t.me/...",
  "discord":          "discord.gg/...",
  "launchedAt":       "2026-05-05T11:48:29.797Z",

  // Set when graduation has happened:
  "graduatedTxHash":      "f326c7...",
  "minswapPoolTxHash":    "77d4bd...",
  "minswapPoolId":        "ec11a2...4d5547",
  "poolAdaLovelace":      "12000000",
  "poolTokens":           "3970836",

  // Set when creator picked a launch vesting window:
  "vestingAddress":         "addr1w...",
  "vestingValidatorCbor":   "...",
  "vestingUnlockMs":        1799123456000,
  "vestingClaimedTxHash":   "...",
  "extraVestings":          [ /* additional re-vest positions */ ],

  // Set on tokens launched after the fee accumulator shipped:
  "feeAccumulatorAddress":         "addr1w...",
  "feeAccumulatorValidatorCbor":   "...",
  "feeAccumulatorClaimedTxHash":   "..."
}`}</CodeBlock>

        <Examples>
          <Example label="curl">{`curl ${BASE}/api/tokens`}</Example>
          <Example label="ts">{`const tokens = await fetch('${BASE}/api/tokens').then(r => r.json());
for (const t of tokens) {
  console.log(t.ticker, t.policyId);
}`}</Example>
        </Examples>
      </Section>

      {/* ── /api/token/[policyId] ─────────────────────────────────────── */}
      <Section id="token-by-id" method="GET" path="/api/token/{policyId}">
        <p style={p}>Single token lookup with live curve state attached.
          Cheaper than fetching <code style={code}>/api/tokens</code> and
          filtering when you already know the policy ID.</p>

        <p style={pTitle}>Response (200):</p>
        <CodeBlock>{`{
  ...all TokenMeta fields,
  "live": {
    "adaReserve":    "12345678",       // lovelace currently at the curve
    "tokenReserve":  "987654321",      // tokens still purchasable
    "priceLovelace": "12500",          // (adaReserve+virtual)*1e6/tokenReserve
    "marketCapAda":  4321.5,           // priceLovelace * total_supply / 1e6
    "bondedPct":     5.88,             // 0–100, 100 = at graduation
    "graduated":     false
  }
}`}</CodeBlock>
        <p style={p}><code style={code}>live</code> is <code style={code}>null</code> for
          fully-graduated tokens whose curve UTxO has been drained — read{' '}
          <code style={code}>poolAdaLovelace</code> /{' '}
          <code style={code}>poolTokens</code> from the meta instead.</p>

        <Examples>
          <Example label="curl">{`curl ${BASE}/api/token/ec11a20dc05761a24c415cfc85b42ef5b31caa52dd501082d6744b9c`}</Example>
        </Examples>
      </Section>

      {/* ── /api/curve ────────────────────────────────────────────────── */}
      <Section id="curve" method="GET" path="/api/curve">
        <p style={p}>Raw on-chain curve state. The lowest-latency way to poll
          reserves for a trading agent — bypasses any cache layer above
          Blockfrost.</p>
        <p style={pTitle}>Query params:</p>
        <ParamTable rows={[
          ['address', 'bech32 curve script address (from token meta)', 'required'],
          ['asset',   'concatenation of policyId + assetName (hex)',    'required'],
        ]} />
        <p style={pTitle}>Response (200):</p>
        <CodeBlock>{`{
  "adaReserve":   "5000000",       // lovelace in the curve UTxO
  "tokenReserve": "996679946"      // tokens still in the curve
}`}</CodeBlock>
        <p style={p}>Returns <code style={code}>404</code> with{' '}
          <code style={code}>{'{"error":"curve UTxO not found"}'}</code> after
          the token has graduated and the UTxO is gone.</p>
        <p style={p}><strong style={strong}>Side effect:</strong> any GET to
          this endpoint also kicks off a graduation check for that token. If
          reserves have crossed the threshold and the migration hasn&apos;t
          run yet, the server queues it. Idempotent and safe to poll.</p>

        <Examples>
          <Example label="curl">{`curl "${BASE}/api/curve?address=addr1wxp8497v67f4vzpsrqmc97rv2vyq6vntrzkz4pc2ce92sncmzz5z5&asset=ec11a20dc05761a24c415cfc85b42ef5b31caa52dd501082d6744b9c4d5547"`}</Example>
        </Examples>
      </Section>

      {/* ── /api/quote ────────────────────────────────────────────────── */}
      <Section id="quote" method="GET" path="/api/quote">
        <p style={p}>Pre-trade quote computed against live reserves with the
          on-chain curve math (<code style={code}>quoteBuy</code> /{' '}
          <code style={code}>quoteSellGross</code> from{' '}
          <code style={code}>web/src/lib/curve-math.ts</code>). Same numbers
          the validator will check at submit time — use this so your agent
          and the chain agree.</p>

        <p style={pTitle}>Query params:</p>
        <ParamTable rows={[
          ['policyId',    'token policy ID (from registry)',                 'required'],
          ['side',        '"buy" or "sell"',                                  'required'],
          ['amount',      'bigint string. Buy: lovelace in. Sell: tokens in.', 'required'],
          ['slippageBps', '0–500. Default 50 (0.5%).',                        'optional'],
        ]} />

        <p style={pTitle}>Response (200):</p>
        <CodeBlock>{`{
  "side":             "buy" | "sell",
  "policyId":         "...",
  "assetUnit":        "<policyId><assetName>",
  "amountIn":         "5000000",
  "expectedOut":      "166112956",     // tokens (buy) or lovelace gross (sell)
  "minOut":           "165280391",     // expectedOut after slippage applied
  "creatorFeeBps":    100,
  "creatorFeeLovelace":  "50000",      // bps × ada_in (buy) or × ada_gross (sell)
  "platformFeeLovelace": "1000000",    // flat 1 ADA, paid by buyer/seller
  "adaNetLovelace":   "...",           // sell only — gross − creator − platform
  "reserves":  { "adaReserve": "...", "tokenReserve": "..." },
  "graduated": false,
  "slippageBps": 50
}`}</CodeBlock>

        <p style={p}>Returns <code style={code}>409</code> if the curve has
          graduated (no longer tradeable on the bonding curve; route via
          Minswap V2 instead).</p>

        <Examples>
          <Example label="curl (buy 5 ADA)">{`curl "${BASE}/api/quote?policyId=POLICY&side=buy&amount=5000000"`}</Example>
          <Example label="curl (sell 1M tokens)">{`curl "${BASE}/api/quote?policyId=POLICY&side=sell&amount=1000000"`}</Example>
        </Examples>
      </Section>

      {/* ── /api/holders ──────────────────────────────────────────────── */}
      <Section id="holders" method="GET" path="/api/holders">
        <p style={p}>Top holders of an asset, derived from Blockfrost&apos;s
          asset-addresses index. Includes the bonding curve and any vesting
          script addresses — filter client-side if you only want wallets.</p>
        <p style={pTitle}>Query params:</p>
        <ParamTable rows={[
          ['asset', 'concatenation of policyId + assetName (hex)', 'required'],
        ]} />
        <p style={pTitle}>Response (200) — array of:</p>
        <CodeBlock>{`{
  "address":  "addr1q...",
  "quantity": "996679946"   // bigint string
}`}</CodeBlock>
        <Examples>
          <Example label="curl">{`curl "${BASE}/api/holders?asset=ec11a20dc05761a24c415cfc85b42ef5b31caa52dd501082d6744b9c4d5547"`}</Example>
        </Examples>
      </Section>

      {/* ── /api/trades ───────────────────────────────────────────────── */}
      <Section id="trades" method="GET" path="/api/trades">
        <p style={p}>Recent trades on a curve, derived from on-chain tx
          deltas. Sorted newest first, capped at 25 entries. Each row reports
          the actual buyer/seller (the wallet that signed the tx, identified
          via inputs — not the treasury or creator-fee output addresses).</p>
        <p style={pTitle}>Query params:</p>
        <ParamTable rows={[
          ['address', 'bech32 curve script address',          'required'],
          ['asset',   'concatenation of policyId + assetName', 'required'],
        ]} />
        <p style={pTitle}>Response (200) — array of:</p>
        <CodeBlock>{`{
  "txHash":     "9a1b2c...",
  "type":       "buy" | "sell",
  "adaDelta":   "10000000",        // |Δ ada_reserve| in lovelace
  "tokenDelta": "32156789",        // |Δ token_reserve| in token units
  "trader":     "addr1q...",
  "blockTime":  1777991234         // unix seconds
}`}</CodeBlock>
        <p style={p}>Cached for 24h per tx-hash via Next.js ISR — recent
          trades come live, deeper history is stable so we don&apos;t
          re-query Blockfrost on every page load.</p>
      </Section>

      {/* ── /api/price-history ────────────────────────────────────────── */}
      <Section id="price-history" method="GET" path="/api/price-history">
        <p style={p}>OHLC bars for chart rendering. Server buckets trades
          into the requested timeframe. Same query params as{' '}
          <code style={code}>/api/trades</code> plus the bucket size.</p>
        <p style={pTitle}>Query params:</p>
        <ParamTable rows={[
          ['address',   'bech32 curve script address',          'required'],
          ['asset',     'concatenation of policyId + assetName', 'required'],
          ['timeframe', '"5m" | "15m" | "1h" | "all". Default "15m".', 'optional'],
        ]} />
        <p style={pTitle}>Response (200) — array of bars:</p>
        <CodeBlock>{`{
  "t":         "5/5 13:00",         // formatted display label
  "timestamp": 1777991100,          // unix seconds (bucket start)
  "open":      0.04,
  "high":      0.045,
  "low":       0.04,
  "close":     0.043
}`}</CodeBlock>
        <p style={p}>Prices are floating-point ADA-per-token, derived from
          the curve datum at each tx (not lovelace). For the precise on-chain
          price use <code style={code}>/api/curve</code> →{' '}
          <code style={code}>spotPrice</code> from{' '}
          <Link href="/docs/protocol#curve-math" style={link}>curve-math</Link>.</p>
      </Section>

      {/* ── /api/wallet-assets ────────────────────────────────────────── */}
      <Section id="wallet-assets" method="GET" path="/api/wallet-assets">
        <p style={p}>Non-ADA assets held by a Cardano address, with LumpFun
          registry metadata joined on for any asset that was launched via
          this protocol.</p>
        <p style={pTitle}>Query params:</p>
        <ParamTable rows={[
          ['address', 'bech32 (mainnet addr1...)', 'required'],
        ]} />
        <p style={pTitle}>Response (200):</p>
        <CodeBlock>{`{
  "assets": [
    {
      "unit":     "ec11a20...4d5547",
      "quantity": "3298081",
      "registry": {                     // present only for LumpFun-launched tokens
        "policyId":  "ec11a20...",
        "assetName": "4d5547",
        "ticker":    "MUG",
        "name":      "Mug",
        "imageUri":  "https://..."
      }
    }
  ]
}`}</CodeBlock>
        <p style={p}>Returns <code style={code}>{'{"assets": []}'}</code>{' '}
          (status 200) if Blockfrost hasn&apos;t indexed the address yet —
          common for fresh wallets that haven&apos;t transacted.</p>
      </Section>

      {/* ── Errors ────────────────────────────────────────────────────── */}
      <Section id="errors" method="" path="Errors">
        <p style={p}>Errors are JSON with a single{' '}
          <code style={code}>error</code> field. Common shapes:</p>
        <ul style={ul}>
          <Item><code style={code}>400</code> — missing/invalid query params (e.g. non-bigint <code style={code}>amount</code>).</Item>
          <Item><code style={code}>404</code> — token not in registry, or curve UTxO not on-chain (graduated tokens).</Item>
          <Item><code style={code}>409</code> — operation not applicable to current state (e.g. quote on a graduated curve).</Item>
          <Item><code style={code}>500</code> — internal error. Includes the message from the underlying source (Blockfrost, Lucid, etc.).</Item>
          <Item><code style={code}>502</code> — upstream Blockfrost rejected the call. Usually means a malformed address.</Item>
        </ul>
      </Section>
    </div>
  );
}

// ── Tiny doc helpers ──────────────────────────────────────────────────────

function Toc({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    <div
      className="rounded-xl p-4 mb-10 flex flex-col gap-1.5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
    >
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>
        Endpoints
      </p>
      {items.map(i => (
        <a
          key={i.id}
          href={`#${i.id}`}
          className="text-sm hover:[color:var(--teal)] transition-colors"
          style={{
            color: 'var(--text)',
            fontFamily: 'var(--font-jetbrains), monospace',
            textDecoration: 'none',
          }}
        >
          {i.label}
        </a>
      ))}
    </div>
  );
}

function Section({ id, method, path, children }: { id: string; method: string; path: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-12 scroll-mt-20">
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        {method && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{
              background: method === 'GET' ? 'rgba(92,224,210,0.15)' : 'rgba(232,90,42,0.15)',
              color: method === 'GET' ? 'var(--teal)' : 'var(--lava-bright)',
              border: `1px solid ${method === 'GET' ? 'rgba(92,224,210,0.3)' : 'rgba(232,90,42,0.3)'}`,
              fontFamily: 'var(--font-outfit)',
            }}
          >
            {method}
          </span>
        )}
        <h2
          className="font-bold"
          style={{
            fontSize: 22,
            color: 'var(--text-bright)',
            fontFamily: 'var(--font-jetbrains), monospace',
          }}
        >
          {path}
        </h2>
      </div>
      <div>{children}</div>
    </section>
  );
}

function ParamTable({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <table
      className="w-full text-xs mb-4"
      style={{ fontFamily: 'var(--font-jetbrains), monospace', borderCollapse: 'collapse' }}
    >
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <th className="text-left py-1.5 pr-3 font-semibold" style={{ color: 'var(--text-dim)' }}>name</th>
          <th className="text-left py-1.5 pr-3 font-semibold" style={{ color: 'var(--text-dim)' }}>description</th>
          <th className="text-left py-1.5 font-semibold"      style={{ color: 'var(--text-dim)' }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, d, r]) => (
          <tr key={k} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td className="py-1.5 pr-3" style={{ color: 'var(--teal)' }}>{k}</td>
            <td className="py-1.5 pr-3" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}>{d}</td>
            <td className="py-1.5"      style={{ color: r === 'required' ? 'var(--lava-bright)' : 'var(--text-dim)' }}>{r}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Examples({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 mb-2">{children}</div>;
}

function Example({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider mb-1.5"
        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}>
        {label}
      </p>
      <CodeBlock>{children}</CodeBlock>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      className="rounded-lg p-3 mb-2 overflow-x-auto text-xs"
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

const h1: React.CSSProperties = {
  fontFamily: 'var(--font-outfit), system-ui, sans-serif',
  fontSize: 'clamp(36px, 5vw, 56px)',
  color: 'var(--text-bright)',
  letterSpacing: '-0.02em',
};
const p: React.CSSProperties = {
  fontFamily: 'var(--font-outfit)',
  fontSize: 14,
  color: 'var(--text-dim)',
  lineHeight: 1.6,
  marginBottom: 14,
};
const pTitle: React.CSSProperties = {
  ...p,
  marginBottom: 6,
  color: 'var(--text)',
  fontWeight: 600,
};
const ul: React.CSSProperties = {
  fontFamily: 'var(--font-outfit)',
  fontSize: 14,
  color: 'var(--text-dim)',
  lineHeight: 1.7,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 14,
};
const code: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  padding: '2px 6px',
  borderRadius: 4,
  fontFamily: 'var(--font-jetbrains), monospace',
  fontSize: 12,
  color: 'var(--teal)',
};
const link: React.CSSProperties = {
  color: 'var(--teal)',
  textDecoration: 'underline',
};
const breadcrumb: React.CSSProperties = {
  color: 'var(--text-dim)',
  textDecoration: 'none',
};
const strong: React.CSSProperties = {
  color: 'var(--text)',
  fontWeight: 600,
};

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start">
      <span aria-hidden style={{ color: 'var(--lava-bright)', marginTop: 4, fontSize: 10 }}>▸</span>
      <span>{children}</span>
    </li>
  );
}
