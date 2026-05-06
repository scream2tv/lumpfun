import { NextResponse } from 'next/server';
import { getTokenByPolicyId, patchToken } from '@/lib/registry';

// Append a creator-added vesting position to the token's registry record.
// Idempotent on (policyId + address) — repeat calls with the same lock
// address are no-ops, so retries after a wallet hiccup are safe.

interface Body {
  policyId:      string;
  address:       string;
  validatorCbor: string;
  unlockMs:      number;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { policyId, address, validatorCbor, unlockMs } = body;
  if (!policyId || !address || !validatorCbor || !Number.isFinite(unlockMs)) {
    return NextResponse.json({ error: 'policyId, address, validatorCbor, unlockMs required' }, { status: 400 });
  }

  const meta = await getTokenByPolicyId(policyId);
  if (!meta) return NextResponse.json({ error: 'token not in registry' }, { status: 404 });

  const existing = meta.extraVestings ?? [];
  if (existing.find(v => v.address === address)) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  const next = [...existing, { address, validatorCbor, unlockMs, addedAt: new Date().toISOString() }];

  try {
    await patchToken(policyId, { extraVestings: next });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
