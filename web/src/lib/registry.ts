import 'server-only';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TokenMeta } from './types';

// Persistent token registry with two backends:
//
//   • Vercel KV (production) — when KV_REST_API_URL is set (auto-injected by
//     Vercel after creating a KV/Upstash store and connecting it to the project).
//   • Local JSON file (dev)   — falls back to ../cardano-registry.json so the
//     existing dev workflow keeps working without any cloud setup.
//
// All tokens are stored under a single KV key as a JSON array, mirroring the
// file format. Writes are serialised through an in-process promise queue to
// prevent two concurrent launches from clobbering each other within one
// function instance. Cross-instance races are still possible on the multi-
// region edge, but the window is tiny in practice; we can layer an Upstash
// transaction in if it ever becomes a problem.

const REGISTRY_PATH = join(process.cwd(), '..', 'cardano-registry.json');
const KV_KEY = 'registry:tokens';

const useKV = !!process.env.KV_REST_API_URL;

let writeQueue: Promise<void> = Promise.resolve();

async function readAllRaw(): Promise<TokenMeta[]> {
  if (useKV) {
    const { kv } = await import('@vercel/kv');
    const value = await kv.get<TokenMeta[]>(KV_KEY);
    return value ?? [];
  }
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw) as TokenMeta[];
  } catch {
    return [];
  }
}

async function writeAllRaw(tokens: TokenMeta[]): Promise<void> {
  if (useKV) {
    const { kv } = await import('@vercel/kv');
    await kv.set(KV_KEY, tokens);
    return;
  }
  await writeFile(REGISTRY_PATH, JSON.stringify(tokens, null, 2));
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getAllTokens(): Promise<TokenMeta[]> {
  return readAllRaw();
}

export async function getTokenByPolicyId(policyId: string): Promise<TokenMeta | null> {
  const all = await readAllRaw();
  return all.find(t => t.policyId === policyId) ?? null;
}

export async function getTokenByCurveAddressAndAsset(
  curveAddress: string,
  assetUnit: string,
): Promise<TokenMeta | null> {
  const all = await readAllRaw();
  return all.find(t => t.curveAddress === curveAddress && `${t.policyId}${t.assetName}` === assetUnit) ?? null;
}

export async function addToken(meta: TokenMeta): Promise<{ ok: boolean; error?: string }> {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    writeQueue = writeQueue.then(async () => {
      try {
        const tokens = await readAllRaw();
        if (!tokens.find(t => t.policyId === meta.policyId)) {
          tokens.unshift(meta);
          await writeAllRaw(tokens);
        }
        resolve({ ok: true });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
}

export async function patchToken(policyId: string, patch: Partial<TokenMeta>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    writeQueue = writeQueue.then(async () => {
      try {
        const tokens = await readAllRaw();
        const idx = tokens.findIndex(t => t.policyId === policyId);
        if (idx < 0) { resolve(); return; }
        tokens[idx] = { ...tokens[idx], ...patch };
        await writeAllRaw(tokens);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}
