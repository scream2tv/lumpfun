import { getWalletInfo, type WalletInfo } from '@/lib/midnight/wallet';
import { CopyButton } from '@/components/copy-button';

interface ContractActivity {
  network: 'preprod';
  fetchedAt: number;
  blocks: Array<{
    hash: string;
    height: number;
    timestamp: number;
    author: string | null;
    transactions: Array<{ hash: string; contractActions: Array<{ address: string }> }>;
  }>;
  uniqueContractAddresses: string[];
}

const INDEXER = 'https://indexer.preprod.midnight.network/api/v4/graphql';
const BLOCK_FIELDS = 'hash height timestamp author transactions { hash contractActions { address } }';

async function indexerQuery<T>(query: string): Promise<T> {
  const res = await fetch(INDEXER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`indexer ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join('; '));
  if (!json.data) throw new Error('indexer returned no data');
  return json.data;
}

async function fetchActivity(): Promise<ContractActivity | { error: string }> {
  try {
    const head = (await indexerQuery<{ b0: ContractActivity['blocks'][number] | null }>(
      `{ b0: block { ${BLOCK_FIELDS} } }`,
    )).b0;
    if (!head) return { error: 'no head block' };

    const aliases = [1, 2, 3, 4].map(
      i => `h${i}: block(offset: { height: ${head.height - i} }) { ${BLOCK_FIELDS} }`,
    );
    const rest = await indexerQuery<Record<string, ContractActivity['blocks'][number] | null>>(
      `{ ${aliases.join(' ')} }`,
    );
    const blocks = [head, ...Object.values(rest).filter((b): b is ContractActivity['blocks'][number] => Boolean(b))];

    const seen = new Set<string>();
    for (const b of blocks) for (const tx of b.transactions) for (const a of tx.contractActions) seen.add(a.address);

    return { network: 'preprod', fetchedAt: Date.now(), blocks, uniqueContractAddresses: [...seen] };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown error' };
  }
}

function walletInfoOrError(): WalletInfo | { error: string } {
  try {
    return getWalletInfo();
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown error' };
  }
}

export default async function MidnightLanding() {
  const [wallet, activity] = await Promise.all([
    Promise.resolve(walletInfoOrError()),
    fetchActivity(),
  ]);

  const VIOLET = '#a78bfa';
  const VIOLET_DEEP = '#7c3aed';

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 64px)',
        background: 'var(--bg-deep)',
        backgroundImage:
          `radial-gradient(ellipse at top, ${VIOLET}1a, transparent 55%),` +
          `radial-gradient(ellipse at bottom, rgba(92,224,210,0.06), transparent 55%)`,
        padding: '48px 16px',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="mb-2 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs"
             style={{ background: `${VIOLET}1a`, border: `1px solid ${VIOLET}33`, color: VIOLET, fontFamily: 'var(--font-mono)' }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: VIOLET, boxShadow: `0 0 8px ${VIOLET}` }} />
          MIDNIGHT · PREPROD
        </div>

        <h1
          className="font-bold leading-none tracking-tight mb-4"
          style={{
            fontFamily: 'var(--font-outfit), system-ui, sans-serif',
            fontSize: 'clamp(48px, 10vw, 112px)',
            letterSpacing: '-0.04em',
          }}
        >
          <span style={{
            background: `linear-gradient(135deg, ${VIOLET} 0%, ${VIOLET_DEEP} 60%, #5ce0d2 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            filter: `drop-shadow(0 0 24px ${VIOLET}55)`,
          }}>
            LumpFun · Midnight
          </span>
        </h1>

        <p style={{ color: 'var(--text-dim)', fontSize: 16, maxWidth: 640, marginBottom: 40, lineHeight: 1.55 }}>
          Privacy-first token launches on Midnight Network. ZK proofs, native NIGHT bonding curves,
          and shielded trading. This is a preprod testnet build — server-signed and unfunded for now.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
          {/* Server wallet card */}
          <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)', borderRadius: 12, padding: 20 }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--font-outfit)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Server wallet
              </h2>
              {'networkId' in wallet ? (
                <span style={{ fontSize: 11, color: VIOLET, fontFamily: 'var(--font-mono)' }}>{wallet.networkId}</span>
              ) : null}
            </header>
            {'error' in wallet ? (
              <p style={{ color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{wallet.error}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <AddrRow label="Unshielded" value={wallet.addresses.unshielded} />
                <AddrRow label="Shielded" value={wallet.addresses.shielded} />
                <AddrRow label="DUST" value={wallet.addresses.dust} />
              </div>
            )}
          </section>

          {/* Activity card */}
          <section style={{ background: 'var(--bg-card)', border: '1px solid var(--border-mid)', borderRadius: 12, padding: 20 }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--font-outfit)', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Recent preprod activity
              </h2>
              {'blocks' in activity ? (
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  head {activity.blocks[0]?.height}
                </span>
              ) : null}
            </header>
            {'error' in activity ? (
              <p style={{ color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{activity.error}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Stat label="Blocks scanned" value={activity.blocks.length.toString()} />
                <Stat label="Unique contracts" value={activity.uniqueContractAddresses.length.toString()} />
                <Stat
                  label="Last block"
                  value={new Date(activity.blocks[0]?.timestamp ?? 0).toLocaleString(undefined, { hour12: false })}
                  small
                />
              </div>
            )}
          </section>
        </div>

        {/* Coming-soon launch card */}
        <section
          style={{
            background: 'var(--bg-card)',
            border: `1px dashed ${VIOLET}55`,
            borderRadius: 12,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, color: VIOLET, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em' }}>
            COMING SOON
          </span>
          <h3 style={{ fontSize: 22, fontFamily: 'var(--font-outfit)', color: 'var(--text-bright)' }}>
            Launch a token on Midnight
          </h3>
          <p style={{ color: 'var(--text-dim)', fontSize: 14, maxWidth: 540, lineHeight: 1.55 }}>
            Server-signed deploy through the funded preprod wallet. Linear bonding curve, immutable fee split,
            ZK-proved trades. Wallet funding and prover wiring are in progress.
          </p>
        </section>
      </div>
    </div>
  );
}

function AddrRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', wordBreak: 'break-all', flex: 1 }}>
          {value}
        </code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontFamily: small ? 'var(--font-mono)' : 'var(--font-outfit)', fontSize: small ? 12 : 18, color: 'var(--text-bright)' }}>
        {value}
      </span>
    </div>
  );
}
