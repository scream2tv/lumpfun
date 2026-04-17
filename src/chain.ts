/**
 * Chain query client for Midnight — JSON-RPC + GraphQL Indexer.
 *
 * Two independent data paths:
 *   1. JSON-RPC — Direct Substrate node (blocks, state, tx queries)
 *   2. GraphQL Indexer — Indexed chain data (blocks, txs, contracts)
 *
 * Read-only surface for LumpFun v0. No tx submission here — tx building
 * and submission happen via the Midnight JS SDK providers in src/launch.ts.
 */

import { getConfig, type MidnightConfig } from './config.js';

// ─── JSON-RPC Transport ─────────────────────────────────────────────────

let rpcIdCounter = 0;

export class RpcError extends Error {
  constructor(
    public code: number,
    public rpcMessage: string,
    public data?: unknown,
  ) {
    super(`RPC error ${code}: ${rpcMessage}`);
    this.name = 'RpcError';
  }
}

export async function rpcCall(
  method: string,
  params: unknown[] = [],
  config?: MidnightConfig,
): Promise<unknown> {
  const { rpcUrl } = config ?? getConfig();
  const payload = {
    jsonrpc: '2.0',
    id: ++rpcIdCounter,
    method,
    params,
  };

  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`RPC HTTP ${resp.status}: ${resp.statusText}`);
  }

  const data = (await resp.json()) as {
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  };

  if (data.error) {
    throw new RpcError(
      data.error.code,
      data.error.message,
      data.error.data,
    );
  }

  return data.result;
}

// ─── GraphQL Indexer Transport ──────────────────────────────────────────

export class IndexerError extends Error {
  constructor(
    public errors: Array<{ message: string }>,
    public query: string,
  ) {
    const msgs = errors.map((e) => e.message).join('; ');
    super(`Indexer errors: ${msgs}`);
    this.name = 'IndexerError';
  }
}

export async function queryIndexer(
  query: string,
  variables?: Record<string, unknown>,
  config?: MidnightConfig,
): Promise<Record<string, unknown>> {
  const { indexerUrl } = config ?? getConfig();
  const payload: Record<string, unknown> = { query };
  if (variables) payload.variables = variables;

  const resp = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Indexer HTTP ${resp.status}: ${resp.statusText}`);
  }

  const data = (await resp.json()) as {
    data?: Record<string, unknown>;
    errors?: Array<{ message: string }>;
  };

  if (data.errors?.length) {
    throw new IndexerError(data.errors, query);
  }

  return data.data ?? {};
}

// ─── High-level queries ─────────────────────────────────────────────────

export interface ChainInfo {
  chainName: string;
  nodeVersion: string;
  genesisHash: string;
}

export async function getChainInfo(config?: MidnightConfig): Promise<ChainInfo> {
  const [chainName, nodeVersion, genesisHash] = await Promise.all([
    rpcCall('system_chain', [], config) as Promise<string>,
    rpcCall('system_version', [], config) as Promise<string>,
    rpcCall('chain_getBlockHash', [0], config) as Promise<string>,
  ]);
  return { chainName, nodeVersion, genesisHash };
}

export interface NodeHealth {
  peers: number;
  isSyncing: boolean;
  shouldHavePeers: boolean;
}

export async function rpcHealth(config?: MidnightConfig): Promise<NodeHealth> {
  const r = (await rpcCall('system_health', [], config)) as Record<string, unknown>;
  return {
    peers: (r.peers as number) ?? 0,
    isSyncing: (r.isSyncing as boolean) ?? true,
    shouldHavePeers: (r.shouldHavePeers as boolean) ?? true,
  };
}

export async function getContractState(
  address: string,
  config?: MidnightConfig,
): Promise<unknown> {
  return rpcCall('midnight_contractState', [address], config);
}

export async function getTxByHash(
  hash: string,
  config?: MidnightConfig,
): Promise<Record<string, unknown> | null> {
  const q = `query { transaction(hash: "${hash}") { hash blockHash blockHeight protocolVersion } }`;
  const result = await queryIndexer(q, undefined, config);
  return (result.transaction as Record<string, unknown> | null) ?? null;
}
