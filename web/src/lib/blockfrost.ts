// Server-only Blockfrost helpers. Never import this from client components.
import type { TokenMeta, Trade } from './types';
import { spotPrice, marketCap, bondedBps, isGraduated } from './curve-math';

const BASE = process.env.BLOCKFROST_BASE_URL ?? 'https://cardano-preprod.blockfrost.io/api/v0';
const KEY  = process.env.BLOCKFROST_PROJECT_ID ?? '';

async function bf(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { project_id: KEY },
    next: { revalidate: 15 },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Blockfrost ${path} → ${res.status}`);
  }
  return res.json();
}

// ── Curve UTxO → datum ────────────────────────────────────────────────────────

function decodeCurveDatum(cbor: string): { adaReserve: bigint; tokenReserve: bigint } | null {
  try {
    // Inline datum is CBOR hex. Strip outer d879 (Constr 0) wrapper and parse two integers.
    // Full CBOR decode without a library: parse manually for our known datum shape.
    // datum = d87982 <uint ada_reserve> <uint token_reserve>
    // We use a simple regex over the hex for MVP.
    const clean = cbor.replace(/^d879[89a-f][0-9a-f]/, '');
    // Both values are CBOR unsigned ints; extract them by parsing the CBOR manually.
    let pos = 0;
    function readUint(hex: string, offset: number): [bigint, number] {
      const b = parseInt(hex.slice(offset, offset + 2), 16);
      if (b <= 0x17) return [BigInt(b), offset + 2];
      if (b === 0x18) return [BigInt(parseInt(hex.slice(offset + 2, offset + 4), 16)), offset + 4];
      if (b === 0x19) return [BigInt(parseInt(hex.slice(offset + 2, offset + 6), 16)), offset + 6];
      if (b === 0x1a) return [BigInt(parseInt(hex.slice(offset + 2, offset + 10), 16)), offset + 10];
      if (b === 0x1b) return [BigInt(parseInt(hex.slice(offset + 2, offset + 18), 16)), offset + 18];
      throw new Error(`Unexpected CBOR major type byte: 0x${b.toString(16)}`);
    }
    const [ada, p1] = readUint(clean, pos);
    const [tokens]  = readUint(clean, p1);
    return { adaReserve: ada, tokenReserve: tokens };
  } catch {
    return null;
  }
}

export async function fetchCurveState(curveAddress: string, assetUnit: string) {
  const utxos = await bf(`/addresses/${curveAddress}/utxos/${assetUnit}`) as Array<{
    inline_datum: string | null;
    amount: Array<{ unit: string; quantity: string }>;
  }> | null;
  if (!utxos || utxos.length === 0) return null;
  const utxo = utxos[0];
  if (!utxo.inline_datum) return null;
  return decodeCurveDatum(utxo.inline_datum);
}

// ── Token metadata ────────────────────────────────────────────────────────────

export async function fetchAssetMeta(policyId: string, assetNameHex: string) {
  const unit = `${policyId}${assetNameHex}`;
  const data = await bf(`/assets/${unit}`) as {
    onchain_metadata?: {
      name?: string;
      image?: string;
      description?: string;
    };
    metadata?: { name?: string; ticker?: string };
  } | null;
  return data;
}

// ── Token list from registry ──────────────────────────────────────────────────
// Read the file directly on the server to avoid HTTP round-trip caching issues.

export async function fetchTokenList(): Promise<TokenMeta[]> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join }     = await import('node:path');
    const registryPath = join(process.cwd(), '..', 'cardano-registry.json');
    const raw = await readFile(registryPath, 'utf8');
    return JSON.parse(raw) as TokenMeta[];
  } catch {
    return [];
  }
}

// ── Token info (curve state + meta combined) ──────────────────────────────────

export async function fetchTokenInfo(meta: TokenMeta) {
  const assetUnit = `${meta.policyId}${meta.assetName}`;
  const state = await fetchCurveState(meta.curveAddress, assetUnit);
  if (!state) return null;

  const { adaReserve, tokenReserve } = state;
  const price = spotPrice(adaReserve, tokenReserve);
  const mcap  = marketCap(adaReserve, tokenReserve);

  return {
    ...meta,
    adaReserve,
    tokenReserve,
    priceLovelace: price,
    marketCapAda: Number(mcap) / 1_000_000,
    bondedPct: Number(bondedBps(adaReserve)) / 100,
    graduated: isGraduated(adaReserve),
  };
}

// ── Holder count ──────────────────────────────────────────────────────────────

export async function fetchHolderCount(assetUnit: string): Promise<number> {
  // Blockfrost has no direct count endpoint; page until short page or cap.
  let total = 0;
  for (let page = 1; page <= 5; page++) {
    const list = await bf(`/assets/${assetUnit}/addresses?count=100&page=${page}&order=desc`) as Array<unknown> | null;
    if (!list || list.length === 0) break;
    total += list.length;
    if (list.length < 100) break;
  }
  return total;
}

// ── Recent trades ─────────────────────────────────────────────────────────────

export async function fetchRecentTrades(curveAddress: string, _assetUnit: string): Promise<Trade[]> {
  const txs = await bf(`/addresses/${curveAddress}/transactions?order=desc&count=20`) as Array<{
    tx_hash: string;
    block_time: number;
  }> | null;
  if (!txs) return [];

  // For MVP just return minimal trade records — full amount decoding requires
  // fetching each tx's UTxOs which is expensive. Return tx hashes for linking.
  return txs.slice(0, 20).map(tx => ({
    txHash: tx.tx_hash,
    type: 'buy' as const,  // Would need datum inspection to know buy vs sell
    lovelace: 0n,
    tokens: 0n,
    address: '',
    timestamp: new Date(tx.block_time * 1000).toISOString(),
  }));
}
