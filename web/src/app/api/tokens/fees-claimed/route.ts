import { NextResponse } from 'next/server';
import { patchToken } from '@/lib/registry';

// Persist the most recent fee-sweep tx hash to the registry so the token
// page can render the success state across reloads. Idempotent.

export async function POST(req: Request) {
  let policyId: string;
  let txHash:   string;
  try {
    const body = await req.json();
    policyId = String(body.policyId ?? '');
    txHash   = String(body.txHash   ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!policyId || !txHash) {
    return NextResponse.json({ error: 'policyId and txHash required' }, { status: 400 });
  }

  try {
    await patchToken(policyId, { feeAccumulatorClaimedTxHash: txHash });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
