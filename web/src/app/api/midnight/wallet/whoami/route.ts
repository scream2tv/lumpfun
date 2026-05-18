import { NextResponse } from 'next/server';
import { getWalletInfo } from '@/lib/midnight/wallet';

export async function GET() {
  try {
    const info = getWalletInfo();
    return NextResponse.json(info);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
