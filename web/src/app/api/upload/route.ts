import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const MAX_BYTES = 5 * 1024 * 1024;

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
};

export async function POST(req: NextRequest) {
  const { dataUrl, mime, filename } = await req.json() as {
    dataUrl: string;
    mime: string;
    filename?: string;
  };

  if (!dataUrl?.startsWith('data:')) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const base64 = dataUrl.split(',')[1];
  if (!base64) return NextResponse.json({ error: 'Empty data' }, { status: 400 });

  const buf = Buffer.from(base64, 'base64');
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 400 });
  }

  const ext =
    EXT_MAP[mime?.toLowerCase()] ??
    EXT_MAP[`image/${filename?.split('.').pop()?.toLowerCase()}`] ??
    'png';

  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, name), buf);

  return NextResponse.json({ url: `/uploads/${name}` });
}
