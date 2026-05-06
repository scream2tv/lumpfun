import { NextResponse } from 'next/server';
import { getTokenByPolicyId, patchToken } from '@/lib/registry';

// Persist the on-chain claim tx hash to the registry so the token page can
// render the success state across reloads. This route is idempotent.
//
// Body:
//   { policyId, txHash }                 → marks the launch vesting claimed
//   { policyId, txHash, address }        → marks the extraVestings[address]
//                                          entry claimed (re-vest positions)

export async function POST(req: Request) {
  let policyId: string;
  let txHash:   string;
  let address:  string | undefined;
  try {
    const body = await req.json();
    policyId = String(body.policyId ?? '');
    txHash   = String(body.txHash   ?? '');
    address  = body.address ? String(body.address) : undefined;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!policyId || !txHash) {
    return NextResponse.json({ error: 'policyId and txHash required' }, { status: 400 });
  }

  try {
    if (address) {
      // Mark a specific extra position as claimed.
      const meta = await getTokenByPolicyId(policyId);
      if (!meta) return NextResponse.json({ error: 'token not in registry' }, { status: 404 });
      const next = (meta.extraVestings ?? []).map(v =>
        v.address === address && !v.claimedTxHash ? { ...v, claimedTxHash: txHash } : v,
      );
      await patchToken(policyId, { extraVestings: next });
    } else {
      await patchToken(policyId, { vestingClaimedTxHash: txHash });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
