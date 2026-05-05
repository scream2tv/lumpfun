import { NextResponse } from 'next/server';
import { getTokenByPolicyId } from '@/lib/registry';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let policyId: string;
  try {
    const body = await req.json();
    policyId = String(body.policyId ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!policyId) {
    return NextResponse.json({ error: 'policyId required' }, { status: 400 });
  }

  const meta = await getTokenByPolicyId(policyId);
  if (!meta) {
    return NextResponse.json({ error: 'token not found in registry' }, { status: 404 });
  }

  const { runGraduation } = await import('@/lib/graduate-server');
  const result = await runGraduation(meta);
  return NextResponse.json(result);
}
