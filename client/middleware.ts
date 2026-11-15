import { NextRequest, NextResponse } from 'next/server';

const WEBGENIXX_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'thewebgenixx.in',
  'www.thewebgenixx.in',
]);
const PIXME_HOSTS = new Set(['pixme.localhost', 'pixme.thewebgenixx.in']);

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host')?.split(':')[0].toLowerCase();
  if (!hostname) return NextResponse.next();
  if (PIXME_HOSTS.has(hostname)) {
    if (request.nextUrl.pathname === '/') {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = '/pixme';
      return NextResponse.rewrite(rewriteUrl);
    }
    return NextResponse.next();
  }
  if (!WEBGENIXX_HOSTS.has(hostname)) return NextResponse.next();

  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    /\.[^/]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!favicon.ico).*)'],
};
