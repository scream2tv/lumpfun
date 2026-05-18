import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const REGISTRY_PATH = join(homedir(), '.lumpfun', 'registry.json');

export interface LaunchRecord {
  contractAddress: string;
  deployTxId: string;
  deployedAt: string;    // ISO timestamp
  name?: string;
  symbol?: string;
}

export function recordLaunch(r: LaunchRecord): void {
  const records = loadLocal();
  if (!records.find((x) => x.contractAddress === r.contractAddress)) {
    records.push(r);
    saveLocal(records);
  }
}

export async function listLaunches(options?: {
  includeRemote?: boolean;
}): Promise<LaunchRecord[]> {
  const local = loadLocal();
  if (!options?.includeRemote) return local;

  const expectedHash = process.env.LUMPFUN_CODE_HASH;
  const remote = await queryRemoteByCodeHash(expectedHash);

  const merged = [...local];
  for (const r of remote) {
    if (!merged.find((x) => x.contractAddress === r.contractAddress)) {
      merged.push(r);
    }
  }
  return merged;
}

export async function getLaunch(address: string): Promise<LaunchRecord | undefined> {
  const list = await listLaunches({ includeRemote: true });
  return list.find((x) => x.contractAddress === address);
}

// ─── Internals ──────────────────────────────────────────────────────────

function loadLocal(): LaunchRecord[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveLocal(records: LaunchRecord[]): void {
  mkdirSync(join(homedir(), '.lumpfun'), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(records, null, 2));
}

async function queryRemoteByCodeHash(_expectedHash?: string): Promise<LaunchRecord[]> {
  // The v4 Midnight indexer has no top-level `contracts` listing — contract
  // discovery requires walking blocks → transactions → contractActions and
  // dedup'ing addresses, which is too expensive to do on every CLI invocation.
  // For now, remote discovery is a no-op; local registry at ~/.lumpfun/registry.json
  // is authoritative. Future work: maintain a server-side index keyed by code hash.
  return [];
}
