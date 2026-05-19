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

// Mirrors LAUNCHES_PAUSED in app/create/page.tsx. Server-side guard so direct
// API calls are rejected too, not just the UI. Flip both to re-enable.
const LAUNCHES_PAUSED: boolean = true;

export async function POST(req: Request) {
  if (LAUNCHES_PAUSED) {
    return NextResponse.json(
      { error: 'Cardano launches are temporarily paused.' },
      { status: 503 },
    );
  }
  const body: TokenMeta = await req.json();
  const result = await addToken(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
