import { NextResponse } from 'next/server';
import { getAllTokens } from '@/lib/registry';
import { fetchFeeAccumulatorStats } from '@/lib/blockfrost';

// Top creator-fee earners across the entire registry. Powers the
// right-rail leaderboard on /feed.
//
// Important subtlety: the fee accumulator script is parameterised by
// creator_pkh ALONE. Two tokens by the same creator share one
// accumulator address, so naively summing per-token would double-count.
// We dedupe by feeAccumulatorAddress: each accumulator is fetched once,
// then mapped back to its creator via the registry.

export const dynamic = 'force-dynamic';

interface Earner {
  creatorAddress: string;
  /** Tokens this creator launched (for display + linking). */
  tokens: Array<{ policyId: string; ticker: string }>;
  /** Pool lifetime = claimed + unclaimed (lovelace as string). */
  lifetime:  string;
  claimed:   string;
  unclaimed: string;
}

interface Body {
  earners:    Earner[];
  /** Sum of all earners' lifetime fees (lovelace as string). */
  total:      string;
  /** Number of accumulator addresses we successfully read. */
  resolved:   number;
  /** Number of accumulator addresses Blockfrost rejected. */
  failed:     number;
}

export async function GET() {
  const tokens = await getAllTokens();

  // accumulator address → { creator, [tokens] }
  const byAccumulator = new Map<string, { creator: string; tokens: Earner['tokens'] }>();
  for (const t of tokens) {
    if (!t.feeAccumulatorAddress) continue;
    const entry = byAccumulator.get(t.feeAccumulatorAddress) ?? {
      creator: t.creatorAddress,
      tokens:  [],
    };
    entry.tokens.push({ policyId: t.policyId, ticker: t.ticker });
    byAccumulator.set(t.feeAccumulatorAddress, entry);
  }

  // Fetch all accumulator stats in parallel — Blockfrost gives us 10rps
  // baseline, and the registry rarely exceeds a few dozen accumulators.
  const results = await Promise.all(
    Array.from(byAccumulator.entries()).map(async ([addr, info]) => {
      const stats = await fetchFeeAccumulatorStats(addr).catch(() => null);
      return { addr, info, stats };
    }),
  );

  // creator → totals (multiple accumulators per creator is impossible
  // under the current parameterisation, but the script could change in
  // the future, so we sum defensively).
  const byCreator = new Map<string, {
    tokens:    Earner['tokens'];
    lifetime:  bigint;
    claimed:   bigint;
    unclaimed: bigint;
  }>();
  let resolved = 0;
  let failed   = 0;
  for (const { info, stats } of results) {
    if (!stats) { failed++; continue; }
    resolved++;
    const cur = byCreator.get(info.creator) ?? {
      tokens:    [],
      lifetime:  0n,
      claimed:   0n,
      unclaimed: 0n,
    };
    cur.tokens.push(...info.tokens);
    cur.lifetime  += stats.lifetime;
    cur.claimed   += stats.claimed;
    cur.unclaimed += stats.unclaimed;
    byCreator.set(info.creator, cur);
  }

  const earners: Earner[] = Array.from(byCreator.entries())
    .map(([creatorAddress, v]) => ({
      creatorAddress,
      tokens:    v.tokens,
      lifetime:  v.lifetime.toString(),
      claimed:   v.claimed.toString(),
      unclaimed: v.unclaimed.toString(),
    }))
    .sort((a, b) => {
      const al = BigInt(a.lifetime), bl = BigInt(b.lifetime);
      return bl > al ? 1 : bl < al ? -1 : 0;
    })
    .slice(0, 10);

  const total = Array.from(byCreator.values())
    .reduce((acc, v) => acc + v.lifetime, 0n)
    .toString();

  const body: Body = { earners, total, resolved, failed };
  return NextResponse.json(body);
}
