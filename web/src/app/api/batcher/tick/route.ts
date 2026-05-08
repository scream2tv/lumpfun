import { NextResponse } from 'next/server';
import { runBatcherTick } from '@/lib/batcher-service';

// One drain pass across every active (non-graduated) token. Idempotent: if
// no orders are pending, this is a cheap no-op. The batcher serializes
// settlement per curve UTxO and waits for confirmation between iterations,
// so a tick can run for a while when many orders queue at once. Vercel Pro
// allows up to 5 minutes of compute per function invocation.
export const maxDuration = 300;

// Cron-callable. Also reachable via /api/orders which kicks the same path
// after the web client locks a fresh order, so users see settlement faster
// than the every-minute cron cadence.
export async function GET() {
  // Default OFF in production. Set NEXT_PUBLIC_USE_QUEUE=1 (and the same
  // CARDANO_NETWORK / TREASURY_SEED you already use for graduation) on the
  // preprod/dev deploy.
  if (process.env.NEXT_PUBLIC_USE_QUEUE !== '1') {
    return NextResponse.json({ ok: true, sink: 'queue-off' });
  }
  try {
    const result = await runBatcherTick();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[batcher/tick] failed:', e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
