import { NextResponse } from 'next/server';
import { runBatcherTick } from '@/lib/batcher-service';

// Trigger-on-submit hook. The web client posts here right after locking a
// fresh order UTxO so the batcher kicks immediately rather than waiting
// out the every-minute cron. The body is currently ignored — the batcher
// will pick up any pending orders from the order_book address either way.
//
// Idempotent: runBatcherTick is gated by an in-flight set, so a flurry of
// near-simultaneous submits collapses into a single drain pass.
export const maxDuration = 300;

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_USE_QUEUE !== '1') {
    return NextResponse.json({ ok: true, sink: 'queue-off' });
  }
  try {
    // Read + discard body (kept so future versions can prioritise a
    // specific token without a breaking-change to the route signature).
    try { await req.json(); } catch { /* empty body is fine */ }

    const result = await runBatcherTick();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/orders] tick failed:', e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
