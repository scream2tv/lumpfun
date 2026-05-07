'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { bech32 } from 'bech32';
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

// ── CIP-30 hex → bech32 (no WASM) ────────────────────────────────────────────
// CIP-30 wallets return getUsedAddresses() entries as CBOR byte-strings:
//   0x58 0xLL <bytes>     (1-byte length)
//   0x59 0xLLLL <bytes>   (2-byte length)
// Strip the CBOR header to get raw address bytes, then bech32-encode with the
// network-appropriate prefix. Cardano addresses can exceed bech32's default
// 90-char limit (Shelley base = 57 bytes → ~103 chars), so we pass 1023.

function cborHexToBech32(hex: string): string {
  // Determine CBOR header → byte count + start offset of raw bytes.
  if (hex.length < 4) throw new Error('hex too short');
  const first = parseInt(hex.slice(0, 2), 16);
  let dataStart: number;
  if (first === 0x58)      dataStart = 4;   // 1-byte length follows
  else if (first === 0x59) dataStart = 6;   // 2-byte length follows
  else if (first >= 0x40 && first <= 0x57) dataStart = 2; // inline length
  else                     dataStart = 0;   // not CBOR-wrapped — treat as raw

  const rawHex = hex.slice(dataStart);
  if (rawHex.length < 2 || rawHex.length % 2 !== 0) throw new Error('bad address bytes');

  const bytes = new Uint8Array(rawHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(rawHex.slice(i * 2, i * 2 + 2), 16);
  }

  // Header byte's low nibble = network ID (1 = mainnet, 0 = testnet).
  const isMainnet = (bytes[0] & 0x0f) === 0x01;
  const prefix = isMainnet ? 'addr' : 'addr_test';

  // Lazy-import bech32 so it stays out of the initial bundle.
  // (Can't `await` here without changing the helper to async; bech32 is
  //  synchronous CommonJS so a static require-style import would work but
  //  Next.js client builds prefer ESM. Inline import via dynamic require is
  //  unsafe; just use a top-level static import — see import block above.)
  const words = bech32.toWords(bytes);
  return bech32.encode(prefix, words, 1023);
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

      // CIP-30 returns CBOR-wrapped hex (`5839…` for a 57-byte Shelley base
      // address). We bech32-encode it ourselves with a tiny pure-JS lib —
      // pulling Lucid Evolution into the connect path drags
      // cardano-multiplatform-lib's WASM client-side, which Turbopack
      // currently mis-URLs (`…wasm?dpl=…` → double-encoded → 404). The trade
      // panel uses Lucid only for Blockfrost calls, never CML, so it dodged
      // this; the connect flow is the one that triggers it.
      const addrs = await api.getUsedAddresses();
      const hexAddr = addrs[0] ?? (await api.getUnusedAddresses())[0] ?? '';
      let address = hexAddr;
      if (hexAddr) {
        try { address = cborHexToBech32(hexAddr); }
        catch { /* leave hex on parse failure */ }
      }

      let lovelace = 0n;
      try {
        const parsed = parseCborLovelace(await api.getBalance());
        // Defensive: parseCborLovelace already returns bigint, but guarantee
        // bigint at the state boundary so downstream `wallet.lovelace + 1n`
        // arithmetic on the token page can never throw a mixed-type error.
        lovelace = typeof parsed === 'bigint' ? parsed : 0n;
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
