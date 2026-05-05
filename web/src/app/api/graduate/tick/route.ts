import { NextResponse } from 'next/server';
import { fetchCurveState } from '@/lib/blockfrost';
import { isGraduated } from '@/lib/curve-math';

export const dynamic = 'force-dynamic';
// One tick may run the full drain + pool pair for one or more pending tokens.
// Allow up to the Vercel Pro 5-minute max so it doesn't get killed mid-tx.
export const maxDuration = 300;

// Cron-style scanner: walk every registry entry that hasn't fully graduated,
// check on-chain state, and trigger migration where applicable. Designed to be
// hit every minute (Vercel cron, external scheduler, manual curl, etc.).
//
// graduate-server is dynamically imported so the heavy Lucid/Minswap stack
// doesn't load during Next.js build-time page collection.
export async function GET() {
  const { findPendingGraduations, runGraduation } = await import('@/lib/graduate-server');
  const pending = await findPendingGraduations();
  if (pending.length === 0) {
    return NextResponse.json({ checked: 0, migrated: [] });
  }

  const results = await Promise.allSettled(
    pending.map(async meta => {
      // Cheap on-chain check before kicking the wallet — only run the full
      // graduation flow if the curve is actually at/above threshold.
      if (!meta.graduatedTxHash) {
        const state = await fetchCurveState(meta.curveAddress, `${meta.policyId}${meta.assetName}`);
        // Per-token override: a curve launched with a small test threshold
        // graduates at that threshold, not the global default.
        const threshold = meta.graduationAdaLovelace ? BigInt(meta.graduationAdaLovelace) : undefined;
        const reached = state && (threshold !== undefined ? state.adaReserve >= threshold : isGraduated(state.adaReserve));
        if (!reached) return { policyId: meta.policyId, skipped: 'not-graduated' };
      }
      const r = await runGraduation(meta);
      return { policyId: meta.policyId, ...r };
    }),
  );

  return NextResponse.json({
    checked:  pending.length,
    migrated: results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { policyId: pending[i].policyId, error: String(r.reason) },
    ),
  });
}
