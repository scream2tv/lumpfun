import { NextResponse } from 'next/server';

// Server-side sink for trade attempt telemetry. Fire-and-forget — the
// client emits one POST per terminal state (success / user_cancelled /
// retry_safe / contact_support). We only echo to Vercel runtime logs;
// nothing is persisted, no PII gates needed.
//
// Disabled by default. Toggle with NEXT_PUBLIC_TX_LOG_SINK=1 (clients
// gate the POST on the same env so requests don't even leave the browser
// when the sink is off).

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_TX_LOG_SINK !== '1') {
    return NextResponse.json({ ok: true, sink: 'disabled' });
  }
  try {
    const body = await req.json();
    // eslint-disable-next-line no-console
    console.info('[tx-attempt]', JSON.stringify(body));
  } catch {
    // Don't surface — we're a sink.
  }
  return NextResponse.json({ ok: true });
}
