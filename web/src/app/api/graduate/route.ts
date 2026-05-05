import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TokenMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';

const REGISTRY_PATH = join(process.cwd(), '..', 'cardano-registry.json');

async function findToken(policyId: string): Promise<TokenMeta | null> {
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    const list = JSON.parse(raw) as TokenMeta[];
    return list.find(t => t.policyId === policyId) ?? null;
  } catch { return null; }
}

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

  const meta = await findToken(policyId);
  if (!meta) {
    return NextResponse.json({ error: 'token not found in registry' }, { status: 404 });
  }

  const { runGraduation } = await import('@/lib/graduate-server');
  const result = await runGraduation(meta);
  return NextResponse.json(result);
}
