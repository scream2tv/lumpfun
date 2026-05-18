import { NextResponse } from 'next/server';

const INDEXER = 'https://indexer.preprod.midnight.network/api/v4/graphql';
const MAX_BLOCKS = 10;

interface IndexerContractAction {
  address: string;
}

interface IndexerTransaction {
  hash: string;
  contractActions: IndexerContractAction[];
}

interface IndexerBlock {
  hash: string;
  height: number;
  timestamp: number;
  author: string | null;
  transactions: IndexerTransaction[];
}

export interface MidnightContractActivity {
  network: 'preprod';
  fetchedAt: number;
  blocks: IndexerBlock[];
  uniqueContractAddresses: string[];
}

const BLOCK_FIELDS = 'hash height timestamp author transactions { hash contractActions { address } }';

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(INDEXER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 15 },
  });
  if (!res.ok) {
    throw new Error(`indexer ${res.status}`);
  }
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map(e => e.message).join('; '));
  }
  if (!json.data) {
    throw new Error('indexer returned no data');
  }
  return json.data;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = Number(searchParams.get('blocks') ?? '3');
  const blockCount = Math.min(Math.max(1, Number.isFinite(requested) ? requested : 3), MAX_BLOCKS);

  try {
    const latest = await graphql<{ b0: IndexerBlock | null }>(`{ b0: block { ${BLOCK_FIELDS} } }`);
    const head = latest.b0;
    if (!head) {
      return NextResponse.json({ error: 'no head block from indexer' }, { status: 502 });
    }

    const blocks: IndexerBlock[] = [head];
    if (blockCount > 1) {
      const aliases = Array.from({ length: blockCount - 1 }, (_, i) => {
        const height = head.height - (i + 1);
        return `b${i + 1}: block(offset: { height: ${height} }) { ${BLOCK_FIELDS} }`;
      });
      const hist = await graphql<Record<string, IndexerBlock | null>>(`{ ${aliases.join(' ')} }`);
      for (let i = 1; i < blockCount; i++) {
        const b = hist[`b${i}`];
        if (b) blocks.push(b);
      }
    }

    const seen = new Set<string>();
    for (const block of blocks) {
      for (const tx of block.transactions) {
        for (const action of tx.contractActions) {
          seen.add(action.address);
        }
      }
    }

    const payload: MidnightContractActivity = {
      network: 'preprod',
      fetchedAt: Date.now(),
      blocks,
      uniqueContractAddresses: [...seen],
    };
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown indexer error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
