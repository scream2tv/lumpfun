import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { queryIndexer } from './chain.js';

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

async function queryRemoteByCodeHash(expectedHash?: string): Promise<LaunchRecord[]> {
  // The preprod indexer's schema for contract listings isn't documented here;
  // start with a best-effort query that fetches contract addresses and filters
  // by the expected code hash if provided.
  //
  // The query shape below mirrors v3 indexer schema assumptions (may need
  // adjustment after inspecting the actual preprod schema).
  const query = `
    query ListContracts {
      contracts {
        address
        deployTxId
        codeHash
      }
    }
  `;
  try {
    const data = await queryIndexer(query) as { contracts?: Array<any> };
    const rows = data.contracts ?? [];
    const filtered = expectedHash
      ? rows.filter((c) => c.codeHash === expectedHash)
      : rows;
    return filtered.map((c): LaunchRecord => ({
      contractAddress: c.address,
      deployTxId: c.deployTxId,
      deployedAt: new Date(0).toISOString(),  // indexer may return a real ctime; adjust if so
    }));
  } catch {
    // Schema mismatch or indexer unavailable — fall back to local-only.
    return [];
  }
}
