import { NextResponse } from 'next/server';

const BASE = process.env.BLOCKFROST_BASE_URL ?? 'https://cardano-preprod.blockfrost.io/api/v0';
const KEY  = process.env.BLOCKFROST_PROJECT_ID ?? '';

export interface HolderEntry {
  address: string;
  quantity: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const asset = searchParams.get('asset') ?? '';
  if (!asset) return NextResponse.json([], { status: 400 });

  const res = await fetch(`${BASE}/assets/${asset}/addresses?count=20&order=desc`, {
    headers: { project_id: KEY },
    next: { revalidate: 60 },
  });
  if (!res.ok) return NextResponse.json([]);
  const data: HolderEntry[] = await res.json();
  return NextResponse.json(data);
}
