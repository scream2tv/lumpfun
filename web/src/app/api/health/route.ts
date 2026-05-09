import { NextResponse } from 'next/server';

// Operator/dev probe. Reports whether the server has the env it needs to
// serve the API routes without leaking any secret values. Verifies live
// Blockfrost reachability from the SERVER side, which is the most common
// silent-failure case (NEXT_PUBLIC_* set, server-side BLOCKFROST_PROJECT_ID
// missing → /api/curve 500s, CLI tests still work because they read the
// public key directly).
//
// Curl-able from anywhere; no secrets ever returned. First thing to hit
// when /api/curve is failing.

export const dynamic = 'force-dynamic';

interface HealthReport {
  ok:       boolean;
  network:  string | null;
  env: {
    BLOCKFROST_PROJECT_ID:            'set' | 'missing';
    NEXT_PUBLIC_BLOCKFROST_PROJECT_ID: 'set' | 'missing';
    BLOCKFROST_BASE_URL:              string | null;
    NEXT_PUBLIC_CARDANO_NETWORK:      string | null;
    NEXT_PUBLIC_TREASURY_ADDRESS:     'set' | 'missing';
    TREASURY_SEED:                    'set' | 'missing';
    BATCHER_SEED:                     'set' | 'missing';
    NEXT_PUBLIC_USE_QUEUE:             '1' | '0' | 'unset';
  };
  blockfrost: {
    reachable: boolean;
    status:    number | null;
    error:     string | null;
  };
  hints: string[];
}

export async function GET() {
  const env = {
    BLOCKFROST_PROJECT_ID:             process.env.BLOCKFROST_PROJECT_ID            ? 'set' as const : 'missing' as const,
    NEXT_PUBLIC_BLOCKFROST_PROJECT_ID: process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID ? 'set' as const : 'missing' as const,
    BLOCKFROST_BASE_URL:               process.env.BLOCKFROST_BASE_URL ?? null,
    NEXT_PUBLIC_CARDANO_NETWORK:       process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? null,
    NEXT_PUBLIC_TREASURY_ADDRESS:      process.env.NEXT_PUBLIC_TREASURY_ADDRESS    ? 'set' as const : 'missing' as const,
    TREASURY_SEED:                     process.env.TREASURY_SEED                   ? 'set' as const : 'missing' as const,
    BATCHER_SEED:                      process.env.BATCHER_SEED                    ? 'set' as const : 'missing' as const,
    NEXT_PUBLIC_USE_QUEUE:             (process.env.NEXT_PUBLIC_USE_QUEUE === '1' ? '1' : process.env.NEXT_PUBLIC_USE_QUEUE === '0' ? '0' : 'unset') as '1' | '0' | 'unset',
  };

  const network = env.NEXT_PUBLIC_CARDANO_NETWORK;
  const baseUrl = env.BLOCKFROST_BASE_URL ??
    (network === 'Mainnet' ? 'https://cardano-mainnet.blockfrost.io/api/v0'
                           : 'https://cardano-preprod.blockfrost.io/api/v0');
  const projectId = process.env.BLOCKFROST_PROJECT_ID ?? '';

  // Probe: hit Blockfrost /health (or fall back to /epochs/latest). Cheap
  // and tells us auth + network reach in one call.
  let bfStatus: number | null = null;
  let bfError:  string | null = null;
  let bfReachable = false;
  if (projectId) {
    try {
      const res = await fetch(`${baseUrl}/network`, {
        headers: { project_id: projectId },
        cache:   'no-store',
      });
      bfStatus = res.status;
      bfReachable = res.ok;
      if (!res.ok) bfError = await res.text().then(t => t.slice(0, 240)).catch(() => null);
    } catch (e) {
      bfError = e instanceof Error ? e.message : String(e);
    }
  } else {
    bfError = 'BLOCKFROST_PROJECT_ID not set';
  }

  // Targeted hints — the most common operator misconfigurations.
  const hints: string[] = [];
  if (env.BLOCKFROST_PROJECT_ID === 'missing') {
    hints.push('Set BLOCKFROST_PROJECT_ID (server) in web/.env.local — NEXT_PUBLIC_* alone is not enough for /api/curve etc.');
  }
  if (env.NEXT_PUBLIC_CARDANO_NETWORK === 'Mainnet' && env.BLOCKFROST_BASE_URL?.includes('preprod')) {
    hints.push('Network mismatch: NEXT_PUBLIC_CARDANO_NETWORK=Mainnet but BLOCKFROST_BASE_URL points at preprod.');
  }
  if (env.NEXT_PUBLIC_CARDANO_NETWORK === 'Preprod' && env.BLOCKFROST_BASE_URL?.includes('mainnet')) {
    hints.push('Network mismatch: NEXT_PUBLIC_CARDANO_NETWORK=Preprod but BLOCKFROST_BASE_URL points at mainnet.');
  }
  if (bfStatus === 403 || bfStatus === 401) {
    hints.push('Blockfrost rejected the project_id. Check it matches the network (preprod*… vs mainnet*…) and is not exhausted.');
  }
  if (env.TREASURY_SEED === 'missing' && env.BATCHER_SEED === 'missing' && env.NEXT_PUBLIC_USE_QUEUE === '1') {
    hints.push('Queue mode is on but neither BATCHER_SEED nor TREASURY_SEED is set — the batcher cron will throw every tick.');
  }
  if (env.NEXT_PUBLIC_USE_QUEUE === '1' && env.BATCHER_SEED === 'missing' && env.TREASURY_SEED === 'set') {
    hints.push('Queue mode is on with TREASURY_SEED handling batcher signing. Consider setting a separate BATCHER_SEED so graduations and queue settlement use different wallets — limits blast radius if the batcher hot key leaks.');
  }

  const report: HealthReport = {
    ok:       env.BLOCKFROST_PROJECT_ID === 'set' && bfReachable,
    network,
    env,
    blockfrost: { reachable: bfReachable, status: bfStatus, error: bfError },
    hints,
  };
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}
