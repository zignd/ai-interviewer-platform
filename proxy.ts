import { NextResponse, type NextRequest } from 'next/server';
import { GATE_COOKIE, gateToken, safeEqual } from '@/lib/gate';

/**
 * Optional demo password. When DEMO_PASSWORD is set, every page and API route needs the gate cookie,
 * except the gate itself, the cron job and the agent's Custom LLM route (each checks its own secret).
 */
export async function proxy(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const open =
    pathname === '/gate' ||
    pathname === '/api/gate' ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/api/agent-llm/');
  if (open) return NextResponse.next();

  const secret = process.env.CRON_SECRET ?? 'gate';
  const expected = await gateToken(password, secret);
  const given = request.cookies.get(GATE_COOKIE)?.value ?? '';
  if (safeEqual(given, expected)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'password_required', message: 'Enter the demo password first.' } },
      { status: 401 },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = '/gate';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
