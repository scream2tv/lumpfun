import { NextResponse } from 'next/server';
import { fetchCurveState } from '@/lib/blockfrost';
import { getTokenByCurveAddressAndAsset } from '@/lib/registry';

// The fire-and-forget runGraduation call below can take up to ~120s for the
// drain + pool pair. Allow the function to stay alive long enough for that
// background work to complete on Vercel Pro (5-minute max).
export const maxDuration = 300;

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

  // Wrap the Blockfrost call so a missing/wrong server-side
  // BLOCKFROST_PROJECT_ID, a 401 from BF, or a network glitch returns a
  // structured diagnostic the trade panel can surface, instead of bubbling
  // out as an opaque 500. The trade panel's runTrade can match on the
  // 'kind' field and route through the same classifier as wallet errors.
  let state: Awaited<ReturnType<typeof fetchCurveState>>;
  try {
    state = await fetchCurveState(address, asset);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/curve] blockfrost fetch failed:', msg);
    // Detect the most common operator error so the dev/operator sees it
    // at-a-glance instead of grep'ing logs. Never echo the project_id.
    const projectIdSet = !!process.env.BLOCKFROST_PROJECT_ID;
    const network      = process.env.NEXT_PUBLIC_CARDANO_NETWORK ?? '(unset)';
    return NextResponse.json({
      error: 'curve fetch failed',
      reason: msg.slice(0, 240),
      hint:   !projectIdSet
        ? 'BLOCKFROST_PROJECT_ID is not set on the server. The web app needs it for /api/curve etc., not just NEXT_PUBLIC_BLOCKFROST_PROJECT_ID.'
        : `Server is configured for ${network}. Verify BLOCKFROST_BASE_URL matches and the address belongs to that network.`,
      kind: 'blockfrost_unreachable',
    }, { status: 502 });
  }

  if (!state) {
    return NextResponse.json({ error: 'curve UTxO not found', kind: 'utxo_gone' }, { status: 404 });
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
