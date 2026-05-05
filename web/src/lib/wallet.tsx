'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { WalletInfo } from './types';

export interface Cip30Api {
  getUsedAddresses(): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getBalance(): Promise<string>;
  getUtxos(): Promise<string[] | null>;
  signTx(tx: string, partialSign: boolean): Promise<string>;
  submitTx(tx: string): Promise<string>;
}

interface CardanoWindow {
  [key: string]: {
    name: string;
    icon: string;
    enable(): Promise<Cip30Api>;
    isEnabled(): Promise<boolean>;
  };
}

interface WalletContext {
  wallet: WalletInfo | null;
  walletApi: Cip30Api | null;
  connecting: boolean;
  availableWallets: Array<{ key: string; name: string; icon: string }>;
  connect(walletKey: string): Promise<void>;
  disconnect(): void;
}

const Ctx = createContext<WalletContext | null>(null);
const LAST_WALLET_KEY = 'lumpfun_last_wallet';

// ── CBOR Value decoder ────────────────────────────────────────────────────────
// CIP-30 getBalance() returns CBOR `Value`:
//   pure ADA  →  CBOR uint  (major type 0)
//   multi-asset  →  [coin, {policyId: {assetName: qty}}]  (array starts with 0x82)
// Naively slicing the last bytes breaks on multi-asset wallets.
function parseCborLovelace(hex: string): bigint {
  if (!hex || hex.length < 2) return 0n;
  const first = parseInt(hex.slice(0, 2), 16);
  // 0x82 = 2-element CBOR array → [coin, multiasset]; parse coin at index 0
  const coinHex = first === 0x82 ? hex.slice(2) : hex;
  return readCborUint(coinHex);
}

function readCborUint(hex: string): bigint {
  if (!hex || hex.length < 2) return 0n;
  const b = parseInt(hex.slice(0, 2), 16);
  if (b <= 0x17) return BigInt(b);                                          // 0–23 inline
  if (b === 0x18) return BigInt(parseInt(hex.slice(2, 4),   16));           // 1-byte
  if (b === 0x19) return BigInt(parseInt(hex.slice(2, 6),   16));           // 2-byte
  if (b === 0x1a) return BigInt(parseInt(hex.slice(2, 10),  16));           // 4-byte
  if (b === 0x1b) return BigInt(parseInt(hex.slice(2, 18),  16));           // 8-byte
  return 0n;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet,     setWallet]     = useState<WalletInfo | null>(null);
  const [walletApi,  setWalletApi]  = useState<Cip30Api | null>(null);
  const [connecting, setConnecting] = useState(false);

  const getAvailableWallets = useCallback(() => {
    if (typeof window === 'undefined' || !('cardano' in window)) return [];
    const cardano = (window as unknown as { cardano: CardanoWindow }).cardano;
    return Object.entries(cardano)
      .filter(([, v]) => typeof v?.enable === 'function' && v?.name)
      .map(([key, v]) => ({ key, name: v.name, icon: v.icon }));
  }, []);

  const connect = useCallback(async (walletKey: string) => {
    setConnecting(true);
    try {
      const cardano = (window as unknown as { cardano: CardanoWindow }).cardano;
      const api = await cardano[walletKey].enable();

      const addrs = await api.getUsedAddresses();
      const hexAddr = addrs[0] ?? (await api.getUnusedAddresses())[0] ?? '';

      // CIP-30 returns hex; downstream Lucid calls (payToAddress, etc.) want bech32.
      // Convert via CML — failures fall back to hex (better than nothing for display).
      let address = hexAddr;
      if (hexAddr) {
        try {
          const { CML } = await import('@lucid-evolution/lucid');
          address = CML.Address.from_hex(hexAddr).to_bech32(undefined);
        } catch { /* leave as hex */ }
      }

      let lovelace = 0n;
      try {
        lovelace = parseCborLovelace(await api.getBalance());
      } catch { /* ignore */ }

      setWalletApi(api);
      setWallet({ address, lovelace, name: cardano[walletKey].name });
      localStorage.setItem(LAST_WALLET_KEY, walletKey);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    setWalletApi(null);
    localStorage.removeItem(LAST_WALLET_KEY);
  }, []);

  // Auto-reconnect: on mount, re-enable the last used wallet if it's still authorized.
  useEffect(() => {
    const saved = localStorage.getItem(LAST_WALLET_KEY);
    if (!saved || typeof window === 'undefined' || !('cardano' in window)) return;
    const cardano = (window as unknown as { cardano: CardanoWindow }).cardano;
    if (!cardano[saved]) return;
    cardano[saved].isEnabled().then(enabled => {
      if (enabled) connect(saved);
    }).catch(() => { /* wallet may not support isEnabled */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Ctx.Provider
      value={{
        wallet,
        walletApi,
        connecting,
        availableWallets: getAvailableWallets(),
        connect,
        disconnect,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWallet must be inside WalletProvider');
  return ctx;
}
