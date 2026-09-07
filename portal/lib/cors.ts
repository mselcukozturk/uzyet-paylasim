import { NextResponse } from 'next/server';

// index.html başka origin'den (GitHub Pages / Artifact) fetch ile çağırır. Çerez
// kullanılmadığı (Authorization header + bearer token) için credentials modu
// gerekmez — herkese açık, sabit CORS başlıkları yeterli ve güvenli.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function withCors(response: NextResponse) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value);
  return response;
}

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
