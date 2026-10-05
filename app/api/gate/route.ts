import { NextResponse } from 'next/server';
import { GATE_COOKIE, gateToken, safeEqual, safeNext } from '@/lib/gate';

export async function POST(request: Request) {
  const form = await request.formData();
  const given = String(form.get('password') ?? '');
  const next = safeNext(String(form.get('next') ?? '/'));
  const password = process.env.DEMO_PASSWORD;
  const secret = process.env.CRON_SECRET ?? 'gate';
  if (!password) return NextResponse.redirect(new URL(next, request.url), 303);

  const ok = safeEqual(await gateToken(given, secret), await gateToken(password, secret));
  if (!ok) {
    const back = new URL('/gate', request.url);
    back.searchParams.set('error', '1');
    back.searchParams.set('next', next);
    return NextResponse.redirect(back, 303);
  }
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(GATE_COOKIE, await gateToken(password, secret), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
