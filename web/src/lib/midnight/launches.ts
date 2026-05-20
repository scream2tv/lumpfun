/**
 * Server-side registry of LumpFun Midnight launches.
 *
 * For now this reads a committed JSON file at the repo root. Suitable for the
 * preprod demo phase where deployments are infrequent and manually triggered.
 *
 * When the agent runner starts producing launches dynamically (Phase 7+),
 * switch this to a Vercel-KV-backed read/write surface; the public type
 * (LaunchRecord) stays stable.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LaunchRecord {
  /** Hex-encoded 32-byte contract address. */
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  imageUri: string;
  deployTxHash: string;
  deployTxIdentifier: string;
  deployBlockHeight: number;
  deployedAt: string;
  /** Hex-encoded creator coinPublicKey (32 bytes). */
  creator: string;
  curve: {
    basePriceNight: string;
    slopeNight: string;
    maxSupply: string;
  };
  fees: {
    feeBps: number;
    platformShareBps: number;
    creatorShareBps: number;
    referralShareBps: number;
  };
  /** Marks the canonical demo launch the agent runner trades against. */
  demo?: boolean;
}

interface RegistryShape {
  preprod?: LaunchRecord[];
  mainnet?: LaunchRecord[];
}

let cached: RegistryShape | null = null;

function loadRegistry(): RegistryShape {
  if (cached) return cached;
  // The web app runs from `web/`; the registry lives at the repo root one
  // level up. Walk up from process.cwd() to find it; in Vercel builds the
  // process.cwd() is the repo root so a direct read also works.
  const candidates = [
    join(process.cwd(), 'lumpfun-midnight-registry.json'),
    join(process.cwd(), '..', 'lumpfun-midnight-registry.json'),
  ];
  for (const p of candidates) {
    try {
      const text = readFileSync(p, 'utf-8');
      cached = JSON.parse(text) as RegistryShape;
      return cached;
    } catch { /* try next */ }
  }
  cached = {};
  return cached;
}

export function listLaunches(network: 'preprod' | 'mainnet' = 'preprod'): LaunchRecord[] {
  return loadRegistry()[network] ?? [];
}

export function getLaunch(address: string, network: 'preprod' | 'mainnet' = 'preprod'): LaunchRecord | undefined {
  const lower = address.toLowerCase().replace(/^0x/, '');
  return listLaunches(network).find(l => l.address.toLowerCase() === lower);
}

export function getDemoLaunch(network: 'preprod' | 'mainnet' = 'preprod'): LaunchRecord | undefined {
  return listLaunches(network).find(l => l.demo);
}
