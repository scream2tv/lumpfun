import { NextResponse } from 'next/server';
import { fetchCurveState } from '@/lib/blockfrost';
import { getTokenByCurveAddressAndAsset } from '@/lib/registry';

// Fire-and-forget: when a curve poll detects a graduated state, kick off the
// server-side migration. Idempotent and rate-limited inside graduate-server.
async function maybeTriggerGraduation(address: string, asset: string) {
  try {
    const meta = await getTokenByCurveAddressAndAsset(address, asset);
    if (!meta) return;
    if (meta.graduatedTxHash && meta.minswapPoolTxHash) return;
    const { runGraduation } = await import('@/lib/graduate-server');
    void runGraduation(meta).catch(() => { /* swallow — cron will retry */ });
  } catch { /* registry missing — ignore */ }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address') ?? '';
  const asset   = searchParams.get('asset') ?? '';

  if (!address || !asset) {
    return NextResponse.json({ error: 'address and asset required' }, { status: 400 });
  }

  const state = await fetchCurveState(address, asset);
  if (!state) {
    return NextResponse.json({ error: 'curve UTxO not found' }, { status: 404 });
  }

  // Always offer to graduate — runGraduation is idempotent and the validator
  // rejects drains below threshold. Per-token thresholds (test launches with
  // a small graduationAdaLovelace) are handled inside graduate-server.
  void maybeTriggerGraduation(address, asset);

  return NextResponse.json({
    adaReserve:   state.adaReserve.toString(),
    tokenReserve: state.tokenReserve.toString(),
  });
}
