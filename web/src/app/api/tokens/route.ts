import { NextResponse } from 'next/server';
import type { TokenMeta } from '@/lib/types';
import { getAllTokens, addToken } from '@/lib/registry';

export async function GET() {
  try {
    const tokens = await getAllTokens();
    return NextResponse.json(tokens);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body: TokenMeta = await req.json();
  const result = await addToken(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
