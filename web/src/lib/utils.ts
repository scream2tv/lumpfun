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
