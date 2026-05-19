/**
 * Server-side helpers for the Midnight preprod GraphQL indexer.
 *
 * The v4 schema has no top-level "address balance" query — only block /
 * transaction / contractAction reads. For the LumpFun preprod UI we walk a
 * window of recent blocks and surface their transactions + contract actions.
 *
 * All fetches use `cache: 'no-store'` — Next.js's fetch dedup was returning
 * day-old responses in dev with revalidate hints.
 *
 * Endpoint selection:
 *   - If BLOCKFROST_MIDNIGHT_KEY is set, route through Blockfrost's preprod
 *     proxy with the project_id header (higher rate limits, paid SLA).
 *   - Otherwise hit the public indexer directly (free, no auth).
 *   - MIDNIGHT_INDEXER_URL overrides the default public URL only.
 *
 * Same v4 GraphQL schema in either case — Blockfrost is a proxy, not a
 * separate API.
 */

const PUBLIC_INDEXER = process.env.MIDNIGHT_INDEXER_URL
  ?? 'https://indexer.preprod.midnight.network/api/v4/graphql';
const BLOCKFROST_KEY = process.env.BLOCKFROST_MIDNIGHT_KEY;
const BLOCKFROST_URL = 'https://midnight-preprod.blockfrost.io/api/v0';

const ACTIVE_INDEXER = BLOCKFROST_KEY ? BLOCKFROST_URL : PUBLIC_INDEXER;

const BLOCK_FIELDS = `
  hash
  height
  timestamp
  author
  transactions {
    hash
    __typename
    contractActions { address }
    unshieldedCreatedOutputs { owner value tokenType }
  }
`;

export interface MidnightTransaction {
  hash: string;
  __typename: 'RegularTransaction' | 'SystemTransaction';
  contractActions: Array<{ address: string }>;
  unshieldedCreatedOutputs: Array<{ owner: string; value: string; tokenType: string }>;
}

export interface MidnightBlock {
  hash: string;
  height: number;
  timestamp: number;
  author: string | null;
  transactions: MidnightTransaction[];
}

export class IndexerError extends Error {}

async function gql<T>(query: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (BLOCKFROST_KEY) headers['project_id'] = BLOCKFROST_KEY;

  const res = await fetch(ACTIVE_INDEXER, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  if (!res.ok) throw new IndexerError(`indexer ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new IndexerError(json.errors.map(e => e.message).join('; '));
  if (!json.data) throw new IndexerError('indexer returned no data');
  return json.data;
}

export async function getHead(): Promise<MidnightBlock> {
  const data = await gql<{ b0: MidnightBlock | null }>(`{ b0: block { ${BLOCK_FIELDS} } }`);
  if (!data.b0) throw new IndexerError('no head block');
  return data.b0;
}

/** Fetch the latest `count` blocks (1..=10). Two round-trips: head, then a
 *  single batched query for the `count - 1` predecessors. */
export async function getRecentBlocks(count: number): Promise<MidnightBlock[]> {
  const n = Math.min(Math.max(1, count), 10);
  const head = await getHead();
  if (n === 1) return [head];

  const aliases = Array.from({ length: n - 1 }, (_, i) =>
    `h${i + 1}: block(offset: { height: ${head.height - (i + 1)} }) { ${BLOCK_FIELDS} }`,
  );
  const rest = await gql<Record<string, MidnightBlock | null>>(`{ ${aliases.join(' ')} }`);
  const out = [head];
  for (let i = 1; i < n; i++) {
    const b = rest[`h${i}`];
    if (b) out.push(b);
  }
  return out;
}

export interface ActivitySummary {
  network: 'preprod';
  fetchedAt: number;
  blocks: MidnightBlock[];
  uniqueContractAddresses: string[];
}

export async function getActivitySummary(blockCount: number): Promise<ActivitySummary> {
  const blocks = await getRecentBlocks(blockCount);
  const seen = new Set<string>();
  for (const b of blocks) for (const tx of b.transactions) for (const a of tx.contractActions) seen.add(a.address);
  return { network: 'preprod', fetchedAt: Date.now(), blocks, uniqueContractAddresses: [...seen] };
}
