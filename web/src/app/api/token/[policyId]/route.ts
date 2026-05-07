import { NextResponse } from 'next/server';
import { getTokenByPolicyId } from '@/lib/registry';
import { fetchTokenInfo } from '@/lib/blockfrost';

// GET /api/token/{policyId}
//
// Returns the registry row for a single token plus its live curve state
// (or post-graduation pool snapshot). Convenience over GET /api/tokens for
// callers that only want one token.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ policyId: string }> },
) {
  const { policyId } = await params;
  if (!policyId) return NextResponse.json({ error: 'policyId required' }, { status: 400 });

  const meta = await getTokenByPolicyId(policyId);
  if (!meta) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const info = await fetchTokenInfo(meta);
  if (!info) {
    // Curve UTxO unreachable AND no pool snapshot — return registry row only.
    return NextResponse.json({ ...meta, live: null });
  }
  return NextResponse.json({
    ...meta,
    live: {
      adaReserve:    info.adaReserve.toString(),
      tokenReserve:  info.tokenReserve.toString(),
      priceLovelace: info.priceLovelace.toString(),
      marketCapAda:  info.marketCapAda,
      bondedPct:     info.bondedPct,
      graduated:     info.graduated,
    },
  });
}
