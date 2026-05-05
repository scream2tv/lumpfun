import { NextResponse } from 'next/server';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TokenMeta } from '@/lib/types';

const REGISTRY_PATH = join(process.cwd(), '..', 'cardano-registry.json');

// Serialize all writes through a single promise chain — prevents concurrent
// launches from clobbering each other on the flat JSON registry.
let writeQueue: Promise<void> = Promise.resolve();

export async function GET() {
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    const tokens: TokenMeta[] = JSON.parse(raw);
    return NextResponse.json(tokens);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const body: TokenMeta = await req.json();

  const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    writeQueue = writeQueue.then(async () => {
      try {
        let tokens: TokenMeta[] = [];
        try {
          const raw = await readFile(REGISTRY_PATH, 'utf8');
          tokens = JSON.parse(raw);
        } catch { /* empty or missing registry */ }

        if (!tokens.find(t => t.policyId === body.policyId)) {
          tokens.unshift(body);
          await writeFile(REGISTRY_PATH, JSON.stringify(tokens, null, 2));
        }
        resolve({ ok: true });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
