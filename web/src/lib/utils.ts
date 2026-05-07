import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Explorer URLs ──────────────────────────────────────────────────────────
// Centralised so we never hardcode preprod links on a mainnet deploy. Reads
// NEXT_PUBLIC_CARDANO_NETWORK at module load (set by the build pipeline).

const EXPLORER_BASE = (process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? 'Preprod') === 'Mainnet'
  ? 'https://cardanoscan.io'
  : 'https://preprod.cardanoscan.io';

export function txExplorerUrl(txHash: string): string {
  return `${EXPLORER_BASE}/transaction/${txHash}`;
}

export function addressExplorerUrl(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`;
}

// ── Safe BigInt coercion ───────────────────────────────────────────────────
// Defensive helper for the token page render path. Inputs sourced from
// JSON, props, or CIP-30 wallets occasionally arrive as plain numbers or
// malformed strings on certain wallet/browser combos; folding those into a
// BigInt expression (`x * BigInt(...)`, `wallet.lovelace + 1_000_000n`) was
// crashing the page with "Cannot mix BigInt and other types". Rather than
// trust each call site, every untrusted-shape value flows through this.
export function safeBigInt(x: unknown, fallback: bigint = 0n): bigint {
  if (typeof x === 'bigint') return x;
  if (x === undefined || x === null) return fallback;
  // BigInt() throws on floats, non-numeric strings, NaN, etc. Coerce
  // numbers to integer first so we never feed it 1.5 (which would throw).
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return fallback;
    try { return BigInt(Math.trunc(x)); } catch { return fallback; }
  }
  if (typeof x === 'string') {
    try { return BigInt(x); } catch { return fallback; }
  }
  try { return BigInt(x as never); } catch { return fallback; }
}
