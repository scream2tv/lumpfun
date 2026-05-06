import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Workaround for a Turbopack bug: WASM chunk URLs are emitted as
//   /_next/static/chunks/<hash>.wasm?dpl=<deploy>
// but somewhere along the way the `?` gets percent-encoded into `%3F`,
// turning the literal request into `/<hash>.wasm%3Fdpl%3D<deploy>` which
// Vercel doesn't have a file for (returns HTML fallback → MIME error).
//
// Catch those mangled URLs and rewrite them to the real path + query.
//
// Triggers only on /_next/static/chunks/* paths, so the cost is one regex
// per static-asset miss; production traffic to other routes is untouched.

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // pathname is already URL-decoded by NextRequest (so we see `?` and `=`),
  // but if the bug lands a literally-encoded `%3F` we may also see that
  // form. Handle both.
  const decoded = decodeURIComponent(path);
  const m = decoded.match(/^(.+\.wasm)\?(.+)$/i);
  if (!m) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = m[1];
  const params = new URLSearchParams(m[2]);
  for (const [k, v] of params) url.searchParams.set(k, v);
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/_next/static/chunks/:path*'],
};
