/**
 * Per-contract trade history reader.
 *
 * The v4 indexer's `contractAction(address, offset)` only does exact-block
 * or exact-tx lookup — useless for enumeration. Instead we walk recent
 * blocks and filter their transactions' contractActions for our target
 * address. Bounded by `blocksBack` (default 5000 = ~8.3h on preprod's
 * 6s block time) to keep latency reasonable. The agent runner will
 * generate trades continuously, so a 5k-block window will be saturated
 * with recent activity in steady state — pre-runner this misses older
 * trades from the demo deploy (~3h ago) but those land in the window
 * naturally as new trades happen.
 *
 * Long-term: switch to the indexer's WSS `contractActions(address)`
 * subscription which streams everything ordered; this is HTTP-only for
 * simplicity.
 */

const INDEXER = process.env.MIDNIGHT_INDEXER_URL
  ?? 'https://indexer.preprod.midnight.network/api/v4/graphql';
const BLOCKFROST_KEY = process.env.BLOCKFROST_MIDNIGHT_KEY;
const BLOCKFROST_URL = 'https://midnight-preprod.blockfrost.io/api/v0';
const ACTIVE_INDEXER = BLOCKFROST_KEY ? BLOCKFROST_URL : INDEXER;
const NATIVE_TOKEN = '0000000000000000000000000000000000000000000000000000000000000000';

async function gql<T>(query: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (BLOCKFROST_KEY) headers['project_id'] = BLOCKFROST_KEY;
  const res = await fetch(ACTIVE_INDEXER, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`indexer ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join('; '));
  if (!json.data) throw new Error('indexer returned no data');
  return json.data;
}

export interface Trade {
  /** Tx hash of the wrapping transaction. */
  txHash: string;
  blockHeight: number;
  /** Unix ms. */
  timestamp: number;
  /** 'buy' or 'sell' or some other circuit name (e.g. 'transfer'). */
  entryPoint: string;
  /** Side from the user's perspective when entryPoint is buy/sell. */
  side: 'buy' | 'sell' | 'other';
  /** Net native-NIGHT movement in atoms. For buy: paid to contract.
   *  For sell: received by user. Other: 0. */
  amountNight: string;
  /** First unshielded native output's owner address; useful for finding the trader on
   *  buys (contract address) or the seller (user coinPubKey). */
  counterparty: string | null;
}

interface RawBlock {
  height: number;
  timestamp: number;
  transactions: Array<{
    hash: string;
    __typename: 'RegularTransaction' | 'SystemTransaction';
    contractActions: Array<{ __typename: string; address: string; entryPoint?: string }>;
    unshieldedCreatedOutputs: Array<{ owner: string; value: string; tokenType: string }>;
  }>;
}

const BLOCK_FIELDS = `
  height
  timestamp
  transactions {
    hash
    __typename
    contractActions {
      __typename
      address
      ... on ContractCall { entryPoint }
    }
    unshieldedCreatedOutputs { owner value tokenType }
  }
`;

function extractTradeFromTx(
  block: RawBlock,
  tx: RawBlock['transactions'][number],
  contractAddress: string,
): Trade | null {
  const ourAction = tx.contractActions.find(a => a.address === contractAddress);
  if (!ourAction || ourAction.__typename !== 'ContractCall') return null;
  const entryPoint = ourAction.entryPoint ?? 'unknown';
  const nativeOuts = tx.unshieldedCreatedOutputs.filter(o => o.tokenType === NATIVE_TOKEN);

  // Coarse proxy for trade size: the largest native unshielded output in the
  // wrapping tx. For a sell this is the seller's payout; for a buy it's the
  // change going back to the buyer (so total in = change + curveCost, but
  // change dominates). Good enough for a tape view; per-trade NIGHT-cost
  // breakdown can come from circuit-arg decoding later.
  let amountNight = '0';
  let counterparty: string | null = null;
  if (nativeOuts.length > 0) {
    const biggest = nativeOuts.reduce((a, b) => (BigInt(b.value) > BigInt(a.value) ? b : a));
    amountNight = biggest.value;
    counterparty = biggest.owner;
  }

  const side: Trade['side'] = entryPoint === 'buy' ? 'buy'
    : entryPoint === 'sell' ? 'sell'
    : 'other';

  return {
    txHash: tx.hash,
    blockHeight: block.height,
    timestamp: block.timestamp,
    entryPoint,
    side,
    amountNight,
    counterparty,
  };
}

export async function fetchRecentTrades(
  contractAddress: string,
  limit = 25,
  blocksBack = 1000,
): Promise<Trade[]> {
  // Find head height first.
  const head = (await gql<{ b: { height: number } | null }>(`{ b: block { height } }`)).b;
  if (!head) return [];

  const trades: Trade[] = [];
  const BATCH = 5;
  const CONCURRENCY = 8;

  // Walk back from head in batches of BATCH blocks, CONCURRENCY batches in flight.
  const starts: number[] = [];
  for (let s = 0; s < blocksBack; s += BATCH) starts.push(s);

  // Process in groups, but stop as soon as we have enough trades.
  // Each batch is one indexer round-trip with `BATCH` aliased blocks.
  outer:
  for (let i = 0; i < starts.length; i += CONCURRENCY) {
    const group = starts.slice(i, i + CONCURRENCY);
    const results = await Promise.all(group.map(async start => {
      const aliases: string[] = [];
      for (let j = start; j < Math.min(start + BATCH, blocksBack); j++) {
        const h = head.height - j;
        if (h <= 0) continue;
        aliases.push(`b${j}: block(offset: { height: ${h} }) { ${BLOCK_FIELDS} }`);
      }
      if (aliases.length === 0) return [] as RawBlock[];
      try {
        const data = await gql<Record<string, RawBlock | null>>(`{ ${aliases.join(' ')} }`);
        return Object.values(data).filter((b): b is RawBlock => b !== null);
      } catch {
        return [] as RawBlock[];
      }
    }));

    // Flatten + sort newest-first within this group, then extract trades.
    const blocks = results.flat().sort((a, b) => b.height - a.height);
    for (const block of blocks) {
      for (const tx of block.transactions) {
        const trade = extractTradeFromTx(block, tx, contractAddress);
        if (trade) {
          trades.push(trade);
          if (trades.length >= limit) break outer;
        }
      }
    }
  }
  return trades.sort((a, b) => b.blockHeight - a.blockHeight);
}
