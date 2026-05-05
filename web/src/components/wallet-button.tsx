'use client';

import { useState } from 'react';
import { useWallet } from '@/lib/wallet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

function truncate(addr: string) {
  if (addr.length < 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function adaDisplay(lovelace: bigint) {
  return `${(Number(lovelace) / 1_000_000).toFixed(2)} ₳`;
}

export function WalletButton() {
  const { wallet, connecting, availableWallets, connect, disconnect } = useWallet();
  const [open, setOpen] = useState(false);

  if (wallet) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="text-sm hidden sm:block"
          style={{ color: 'var(--teal)', fontFamily: 'var(--font-jetbrains), monospace' }}
        >
          {adaDisplay(wallet.lovelace)}
        </span>
        <button
          onClick={disconnect}
          className="inline-flex items-center justify-center rounded-lg text-xs transition-all"
          style={{
            height: 32,
            padding: '0 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-mid)',
            color: 'var(--text)',
            fontFamily: 'var(--font-jetbrains), monospace',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-bright)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-mid)';
          }}
        >
          {truncate(wallet.address)}
        </button>
      </div>
    );
  }

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
