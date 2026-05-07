'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/lib/wallet';
import { safeBigInt } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface AssetRow {
  unit:     string;
  quantity: string;
  registry?: {
    policyId:  string;
    assetName: string;
    ticker:    string;
    name:      string;
    imageUri?: string;
  };
}

function truncate(addr: string) {
  if (addr.length < 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function adaDisplay(lovelace: bigint) {
  // Tolerate non-bigint values from the wallet provider's parseCborLovelace
  // path — the `Number(lovelace) / 1_000_000` op is fine on either, but
  // upstream the value is occasionally folded into BigInt arithmetic, so we
  // normalise once at the display boundary.
  return `${(Number(safeBigInt(lovelace)) / 1_000_000).toFixed(2)} ₳`;
}

function fmtQty(q: string): string {
  // Token quantities are integer strings; format for readability.
  return Number(q).toLocaleString();
}

function unitToLabel(unit: string): { policyId: string; name: string } {
  const policyId = unit.slice(0, 56);
  const nameHex  = unit.slice(56);
  let name = nameHex;
  try {
    if (nameHex) name = Buffer.from(nameHex, 'hex').toString('utf8');
  } catch { /* keep hex */ }
  return { policyId, name };
}

async function fetchWalletAssetsServer(address: string): Promise<AssetRow[]> {
  const res = await fetch(`/api/wallet-assets?address=${encodeURIComponent(address)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.assets ?? [];
}

// Fallback: aggregate non-ADA holdings from the wallet's own UTxOs via Lucid.
// Used when Blockfrost has nothing for the address yet (fresh wallet that
// hasn't been seen on-chain). Cross-references with /api/tokens so registry
// hits get the same deep-link payload as the server path.
async function fetchWalletAssetsFromUtxos(walletApi: unknown, network: 'Mainnet' | 'Preprod'): Promise<AssetRow[]> {
  const baseUrl = network === 'Mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0';
  const projectId = process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID ?? '';

  let utxos: Awaited<ReturnType<ReturnType<Awaited<ReturnType<typeof import('@lucid-evolution/lucid')['Lucid']>>['wallet']>['getUtxos']>>;
  try {
    const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid');
    const lucid = await Lucid(new Blockfrost(baseUrl, projectId), network);
    lucid.selectWallet.fromAPI(walletApi as Parameters<typeof lucid.selectWallet.fromAPI>[0]);
    utxos = await lucid.wallet().getUtxos();
  } catch (e) {
    // Lucid's CBOR-to-bigint translation throws on certain wallet/browser
    // combos (e.g. multi-asset CIP-30 responses where one quantity arrives
    // as a Number). Fail open to the empty list — the server-side path
    // already covers the common case for real users.
    console.warn('[fetchWalletAssetsFromUtxos] lucid.getUtxos failed:', e);
    return [];
  }

  const totals = new Map<string, bigint>();
  for (const u of utxos) {
    for (const [unit, qty] of Object.entries(u.assets)) {
      if (unit === 'lovelace') continue;
      const bq = safeBigInt(qty);
      if (bq === 0n) continue;
      totals.set(unit, (totals.get(unit) ?? 0n) + bq);
    }
  }
  if (totals.size === 0) return [];

  // Optional registry enrichment: ignore failures and just emit raw entries.
  let registry: Array<{ policyId: string; assetName: string; ticker: string; name: string; imageUri?: string }> = [];
  try {
    const r = await fetch('/api/tokens');
    if (r.ok) registry = await r.json();
  } catch { /* best-effort */ }
  const byUnit = new Map<string, typeof registry[number]>();
  for (const t of registry) byUnit.set(`${t.policyId}${t.assetName}`, t);

  const rows: AssetRow[] = Array.from(totals.entries()).map(([unit, qty]) => {
    const meta = byUnit.get(unit);
    return {
      unit,
      quantity: qty.toString(),
      registry: meta && {
        policyId:  meta.policyId,
        assetName: meta.assetName,
        ticker:    meta.ticker,
        name:      meta.name,
        imageUri:  meta.imageUri,
      },
    };
  });
  rows.sort((a, b) => {
    if (!!a.registry !== !!b.registry) return a.registry ? -1 : 1;
    const aq = safeBigInt(a.quantity);
    const bq = safeBigInt(b.quantity);
    return aq > bq ? -1 : aq < bq ? 1 : 0;
  });
  return rows;
}

function ConnectedWallet() {
  const { wallet, walletApi, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside-click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Asset list — refetched on connect, every 30s, and on window focus.
  // Server path uses Blockfrost address lookup; if that comes back empty
  // (Blockfrost 404 for an address it hasn't seen yet, fresh wallet) and we
  // have a walletApi, fall back to aggregating the wallet's own UTxOs via
  // Lucid so the UI matches Vespr/Eternl/etc. reality.
  const { data: assets = [] } = useQuery({
    queryKey: ['wallet-assets', wallet?.address],
    queryFn:  async () => {
      const network = (process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') as 'Mainnet' | 'Preprod';
      const fromServer = await fetchWalletAssetsServer(wallet!.address);
      if (fromServer.length > 0 || !walletApi) return fromServer;
      try {
        return await fetchWalletAssetsFromUtxos(walletApi, network);
      } catch { return fromServer; }
    },
    enabled:  !!wallet?.address,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  if (!wallet) return null;

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <span
        className="text-sm hidden sm:block"
        style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}
      >
        {adaDisplay(wallet.lovelace)}
      </span>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg text-xs transition-all"
        style={{
          height: 32,
          padding: '0 12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-mid)',
          color: 'var(--text)',
          fontFamily: 'var(--font-jetbrains), monospace',
          cursor: 'pointer',
        }}
      >
        {truncate(wallet.address)}
        {assets.length > 0 && (
          <span
            className="text-[10px] px-1.5 py-px rounded"
            style={{
              background: 'rgba(92,224,210,0.12)',
              border: '1px solid rgba(92,224,210,0.3)',
              color: 'var(--teal)',
              fontFamily: 'var(--font-outfit), system-ui, sans-serif',
            }}
          >
            {assets.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-lg overflow-hidden z-50"
          role="menu"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-mid)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
          }}
        >
          {/* Header — ADA balance + sm-only address */}
          <div className="p-3 flex items-baseline justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
                Balance
              </span>
              <span className="text-base font-semibold" style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}>
                {adaDisplay(wallet.lovelace)}
              </span>
            </div>
            <span className="text-[10px]" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-outfit)' }}>
              {wallet.name}
            </span>
          </div>

          {/* Asset list */}
          <div className="max-h-72 overflow-y-auto">
            {assets.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-dim)' }}>
                No native tokens
              </p>
            ) : (
              assets.map((a) => <AssetRowView key={a.unit} a={a} onNavigate={() => setOpen(false)} />)
            )}
          </div>

          {/* Footer */}
          <button
            type="button"
            onClick={() => { disconnect(); setOpen(false); }}
            className="w-full text-xs py-2.5"
            style={{
              background: 'var(--bg-elevated)',
              borderTop: '1px solid var(--border-subtle)',
              color: 'var(--text-dim)',
              fontFamily: 'var(--font-outfit), system-ui, sans-serif',
              cursor: 'pointer',
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function AssetRowView({ a, onNavigate }: { a: AssetRow; onNavigate: () => void }) {
  const fallback = unitToLabel(a.unit);
  const display = a.registry
    ? { ticker: a.registry.ticker, name: a.registry.name, imageUri: a.registry.imageUri }
    : { ticker: fallback.name || 'unknown', name: fallback.policyId.slice(0, 10) + '…', imageUri: undefined };

  const inner = (
    <div
      className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-[var(--bg-elevated)]"
    >
      <div
        className="relative shrink-0 overflow-hidden rounded-md"
        style={{ width: 28, height: 28, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
      >
        {display.imageUri ? (
          <Image src={display.imageUri.replace('ipfs://', 'https://ipfs.io/ipfs/')} alt={display.name} fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-xs font-bold" style={{ color: 'var(--teal)', fontFamily: 'var(--font-outfit)' }}>
            {(display.ticker || '?')[0]}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)', fontFamily: 'var(--font-outfit)' }}>
          {display.ticker}
        </p>
        <p className="text-[10px] truncate" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-jetbrains), monospace' }}>
          {display.name}
        </p>
      </div>
      <span
        className="text-xs tabular-nums shrink-0"
        style={{ color: 'var(--text)', fontFamily: 'var(--font-jetbrains), monospace' }}
      >
        {fmtQty(a.quantity)}
      </span>
    </div>
  );

  if (a.registry) {
    return (
      <Link
        href={`/token/${a.registry.policyId}?asset=${a.registry.assetName}`}
        onClick={onNavigate}
        style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
      >
        {inner}
      </Link>
    );
  }
  return inner;
}

export function WalletButton() {
  const { wallet, connecting, availableWallets, connect } = useWallet();
  const [open, setOpen] = useState(false);

  if (wallet) return <ConnectedWallet />;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-all"
        style={{
          height: 36,
          padding: '0 16px',
          background: 'var(--teal)',
          color: 'var(--bg-deep)',
          fontFamily: 'var(--font-outfit), system-ui, sans-serif',
          boxShadow: connecting ? 'none' : '0 0 16px rgba(92, 224, 210, 0.35)',
          cursor: 'pointer',
          opacity: connecting ? 0.7 : 1,
        }}
      >
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-xs"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-mid)',
          borderRadius: 'var(--r-lg)',
        }}
      >
        <DialogHeader>
          <DialogTitle style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-outfit)' }}>
            Connect Wallet
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          {availableWallets.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--text-dim)' }}>
              No Cardano wallets detected.
              <br />
              Install Nami, Eternl, or Vespr.
            </p>
          ) : (
            availableWallets.map(w => (
              <button
                key={w.key}
                className="flex items-center gap-3 w-full rounded-lg text-sm transition-all"
                style={{
                  padding: '10px 14px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text)',
                  cursor: connecting ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-outfit), system-ui, sans-serif',
                  opacity: connecting ? 0.6 : 1,
                }}
                disabled={connecting}
                onMouseEnter={e => {
                  if (!connecting) {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--teal)';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'var(--glow-teal)';
                  }
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-subtle)';
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
                onClick={async () => {
                  await connect(w.key);
                  setOpen(false);
                }}
              >
                {w.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.icon} alt="" width={20} height={20} className="rounded" />
                )}
                {w.name}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
